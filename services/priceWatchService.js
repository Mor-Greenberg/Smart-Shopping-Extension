const { SITES_CONFIG, isSiteEnabled } = require('../config');
const { COMPARE_TARGET_SITES } = require('../config/cache');
const { getLowestActivePriceForEan } = require('./priceDropService');
const { getWatchableEans, applyPriceCheck } = require('./trackedItemsService');

let watchRunning = false;

function isPriceWatchRunning() {
    return watchRunning;
}

async function getWatchedProducts(pool) {
    const { rows } = await pool.query(
        `SELECT ut.ean,
                MAX(ut.product_name) AS product_name,
                COUNT(*)::int AS watcher_count
         FROM user_tracker ut
         WHERE ut.tracking_type = 'active'
           AND ut.is_active = TRUE
         GROUP BY ut.ean
         ORDER BY watcher_count DESC`
    );
    return rows;
}

/**
 * Both the behavioural trackers and the explicit watchlist need the same fresh
 * scrape, so they are merged into a single pass to avoid scraping an EAN twice.
 */
async function collectWatchTargets(pool) {
    const [trackers, watchlist] = await Promise.all([
        getWatchedProducts(pool),
        getWatchableEans(pool)
    ]);

    const targets = new Map();

    for (const row of trackers) {
        targets.set(row.ean, {
            ean: row.ean,
            productName: row.product_name,
            inWatchlist: false
        });
    }

    for (const row of watchlist) {
        const existing = targets.get(row.ean);
        if (existing) {
            existing.inWatchlist = true;
            existing.productName = existing.productName || row.product_name;
        } else {
            targets.set(row.ean, {
                ean: row.ean,
                productName: row.product_name,
                inWatchlist: true
            });
        }
    }

    return [...targets.values()];
}

function resolveWatchSites() {
    return COMPARE_TARGET_SITES.filter((site) => isSiteEnabled(SITES_CONFIG[site]));
}

/**
 * Re-scrapes every watched EAN, then settles the results two ways:
 *   - processLiveCompare raises price_drop_alerts against each tracker baseline
 *     (feeds the admin "money saved" analytics)
 *   - the cheapest fresh offer is written back onto tracked_items, flipping
 *     has_dropped when it undercuts the price the user saved at
 *
 * processLiveCompare is injected to keep this service free of a circular
 * dependency on server.js.
 */
async function runPriceWatch(pool, processLiveCompare, log = console.log) {
    if (watchRunning) {
        return { ok: false, skipped: true, reason: 'A price watch is already running' };
    }

    watchRunning = true;
    const startedAt = Date.now();
    let scanned = 0;
    let alertsCreated = 0;
    let itemsDropped = 0;
    let failures = 0;

    try {
        const products = await collectWatchTargets(pool);
        const sites = resolveWatchSites();

        if (!products.length) {
            log('INFO', 'Price watch: nothing to scan');
            return { ok: true, scanned: 0, alertsCreated: 0, itemsDropped: 0, failures: 0 };
        }

        log('INFO', 'Price watch started', { products: products.length, sites });

        // One product at a time so the scraper cluster stays responsive for
        // live popup traffic; the sites of a single product run in parallel.
        for (const product of products) {
            const perSite = await Promise.all(sites.map(async (targetSite) => {
                try {
                    const result = await processLiveCompare({
                        ean: product.ean,
                        targetSite,
                        siteSettings: SITES_CONFIG[targetSite],
                        sourceProductName: product.productName
                    });
                    return result.priceDropAlerts || 0;
                } catch (err) {
                    failures += 1;
                    log('WARN', 'Price watch scrape failed', {
                        ean: product.ean,
                        targetSite,
                        error: err.message
                    });
                    return 0;
                }
            }));

            scanned += 1;
            alertsCreated += perSite.reduce((sum, count) => sum + count, 0);

            if (!product.inWatchlist) continue;

            try {
                const lowest = await getLowestActivePriceForEan(pool, product.ean);
                if (lowest) {
                    const applied = await applyPriceCheck(pool, product.ean, {
                        price: lowest.price,
                        productUrl: lowest.product_url,
                        siteKey: lowest.site_key
                    });
                    itemsDropped += applied.dropped;
                }
            } catch (err) {
                failures += 1;
                log('WARN', 'Watchlist update failed', {
                    ean: product.ean,
                    error: err.message
                });
            }
        }

        log('INFO', 'Price watch complete', {
            scanned,
            alertsCreated,
            itemsDropped,
            failures,
            elapsedMs: Date.now() - startedAt
        });

        return { ok: true, scanned, alertsCreated, itemsDropped, failures };
    } catch (err) {
        log('ERROR', 'Price watch failed', { error: err.message });
        return { ok: false, error: err.message };
    } finally {
        watchRunning = false;
    }
}

module.exports = {
    runPriceWatch,
    isPriceWatchRunning,
    getWatchedProducts
};
