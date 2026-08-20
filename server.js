// server.js

const express = require('express');
const cors = require('cors');

const pool = require('./db/pool');
const { getCachedOffers, getUsableCachedOffer, upsertOffer } = require('./services/cacheService');
const { trackProduct, getUserTracker, isTracked, optOutTracking } = require('./services/trackerService');
const { processPriceDropAlerts } = require('./services/priceDropService');
const {
    TrackedItemError,
    addTrackedItem,
    listTrackedItems,
    deleteTrackedItem
} = require('./services/trackedItemsService');
const { runPriceWatch, isPriceWatchRunning } = require('./services/priceWatchService');
const { COMPARE_TARGET_SITES } = require('./config/cache');
const { SITES_CONFIG, resolveSiteEntry } = require('./config');
const { createVerifyAdmin } = require('./middleware/verifyAdmin');
const { attachAdminCatalogRoutes } = require('./routes/adminCatalog');
const { listClubs, createClub, deleteClub } = require('./services/clubService');
const {
    listRetailSites,
    getSiteClubsMap,
    setSiteClubs
} = require('./services/siteClubService');
const { getActiveQuestions, listAllQuestions, createQuestion, updateQuestion, deleteQuestion } = require('./services/questionService');
const { getUserStats, getHealthLogs, getLiveHealth } = require('./services/adminAnalyticsService');
const { runSelectorHealthChecks, isHealthCheckRunning } = require('./services/selectorHealthService');
const { recordCompareEvent } = require('./services/compareAnalyticsService');
const {
    registerUser,
    getRegistrationStatus,
    updateConsumerClubs
} = require('./services/registrationService');
const {
    formatScraperError,
    checkScraperHealth,
    requestLiveScrape,
    SCRAPER_BASE
} = require('./services/scraperClient');

const app = express();
const port = Number(process.env.PORT || 3000);
const verifyAdmin = createVerifyAdmin(pool);

app.use(cors());
app.use(express.json());

function log(level, message, meta = null) {
    const ts = new Date().toISOString();
    const tag = `[${ts}] [Server] [${level}]`;
    if (meta) console.log(`${tag} ${message}`, meta);
    else console.log(`${tag} ${message}`);
}

function formatDbError(err) {
    if (!err) return 'Unknown error';
    if (err.code === 'ECONNREFUSED') {
        return 'PostgreSQL is not running on localhost:5432. Start Postgres, create database smart_shopping_db, then run: npm run migrate';
    }
    if (err.code === '3D000') {
        return 'Database smart_shopping_db does not exist. Create it, then run: npm run migrate';
    }
    if (err.code === '28P01') {
        return 'PostgreSQL password authentication failed. Check db/pool.js credentials.';
    }
    if (err.code === '42P01' || err.code === '42703') {
        return 'Registration tables/columns missing. Run: npm run migrate';
    }
    return err.message || err.code || 'Unknown database error';
}

function formatSiteResult(offer) {
    if (!offer) {
        return { exists: false, cachedPrice: null, productUrl: null };
    }
    return {
        exists: Boolean(offer.exists),
        cachedPrice: offer.cachedPrice ?? null,
        productUrl: offer.productUrl ?? null,
        collectedAt: offer.collectedAt || null,
        fromCache: offer.fromCache ?? true
    };
}

function writeSSE(res, event, data) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function resolveCacheOutcome(data) {
    if (data.error) {
        return {
            outcome: 'skipped',
            onProductPage: false,
            hasPrice: false,
            reason: 'scrape_error'
        };
    }

    const onProductPage = Boolean(
        data.exists
        && data.productUrl
        && !data.productUrl.toLowerCase().includes('/search')
    );

    if (onProductPage && data.price > 0) {
        return { outcome: 'found', onProductPage, hasPrice: true };
    }

    if (onProductPage) {
        return { outcome: 'partial', onProductPage, hasPrice: false, reason: 'price_missing' };
    }

    if (data.exists === false) {
        return { outcome: 'not_found', onProductPage: false, hasPrice: false };
    }

    return { outcome: 'skipped', onProductPage: false, hasPrice: false, reason: 'ambiguous' };
}

async function offerFromCache(ean, targetSite, reason) {
    const cached = await getUsableCachedOffer(pool, ean, targetSite);
    if (!cached) return null;
    return {
        site: targetSite,
        exists: true,
        price: cached.cachedPrice,
        productUrl: cached.productUrl,
        collectedAt: cached.collectedAt,
        fromCache: true,
        priceDropAlerts: 0,
        cacheOutcome: reason
    };
}

async function rememberOriginOffer({
    ean,
    sourceSite,
    sourceUrl,
    sourcePrice,
    sourceProductName
}) {
    if (!ean || !sourceSite || !sourceUrl) return;
    if (String(sourceUrl).toLowerCase().includes('/search')) return;

    const siteKey = resolveSiteEntry(sourceSite)?.key || sourceSite;
    const price = Number(sourcePrice);
    const hasPrice = Number.isFinite(price) && price > 0;

    try {
        await upsertOffer(pool, {
            ean,
            siteKey,
            productUrl: sourceUrl,
            price: hasPrice ? price : null,
            outcome: hasPrice ? 'found' : 'partial',
            productName: sourceProductName || null
        });
        log('INFO', 'Origin offer cached', { ean, siteKey, productUrl: sourceUrl, hasPrice });
    } catch (err) {
        log('WARN', 'Origin offer cache failed', { ean, siteKey, error: err.message });
    }
}

async function processLiveCompare({ ean, targetSite, siteSettings, sourceProductName }) {
    let data;
    try {
        data = await requestLiveScrape({ targetSite, ean, siteSettings, sourceProductName });
    } catch (err) {
        const cached = await offerFromCache(ean, targetSite, 'scraper_error_fallback');
        if (cached) {
            log('WARN', 'Scraper unreachable — returning cached offer', {
                ean,
                targetSite,
                error: formatScraperError(err).message
            });
            return cached;
        }
        throw err;
    }
    const resolved = resolveCacheOutcome(data);
    const { outcome, onProductPage, hasPrice } = resolved;

    if (outcome === 'skipped') {
        const cached = await offerFromCache(ean, targetSite, 'scraper_error_fallback');
        if (cached) {
            log('WARN', 'Inconclusive scrape — returning cached offer', {
                ean,
                targetSite,
                reason: resolved.reason,
                scraperError: data.error || null
            });
            return cached;
        }
        log('WARN', 'Cache write skipped — scrape inconclusive', {
            ean,
            targetSite,
            reason: resolved.reason,
            scraperError: data.error || null,
            exists: data.exists,
            price: data.price,
            productUrl: data.productUrl
        });
    } else {
        let priceDropAlerts = 0;
        let cacheOutcome = outcome;

        try {
            const cacheResult = await upsertOffer(pool, {
                ean,
                siteKey: targetSite,
                productUrl: data.productUrl,
                price: data.price,
                outcome,
                productName: sourceProductName
            });

            if (outcome === 'found') {
                const previousPrice = cacheResult.previousOffer?.price
                    ? Number(cacheResult.previousOffer.price)
                    : null;

                const priceDrop = await processPriceDropAlerts(pool, {
                    ean,
                    siteKey: targetSite,
                    newPrice: data.price,
                    productUrl: data.productUrl,
                    productName: sourceProductName,
                    previousPrice,
                    previousProductUrl: cacheResult.previousOffer?.product_url || null
                });
                priceDropAlerts = priceDrop.alertsCreated || 0;

                log('INFO', 'Price saved to cache', {
                    ean,
                    targetSite,
                    price: data.price,
                    alertsCreated: priceDropAlerts
                });
            } else if (outcome === 'partial') {
                log('INFO', 'Partial cache stored (URL without price)', { ean, targetSite });
            } else if (outcome === 'not_found') {
                log('INFO', 'Negative cache stored', { ean, targetSite });
            }
        } catch (cacheErr) {
            cacheOutcome = 'cache_error';
            log('ERROR', 'Cache write failed — returning live scrape result anyway', {
                ean,
                targetSite,
                error: cacheErr.message,
                code: cacheErr.code
            });
        }

        return {
            site: targetSite,
            exists: onProductPage,
            price: hasPrice ? data.price : null,
            productUrl: onProductPage ? data.productUrl : null,
            collectedAt: new Date().toISOString(),
            fromCache: false,
            priceDropAlerts,
            cacheOutcome
        };
    }

    if (data.error) {
        const err = new Error(data.error);
        err.code = data.code || 'SCRAPE_ERROR';
        throw err;
    }

    return {
        site: targetSite,
        exists: onProductPage,
        price: hasPrice ? data.price : null,
        productUrl: onProductPage ? data.productUrl : null,
        collectedAt: new Date().toISOString(),
        fromCache: false,
        priceDropAlerts: 0,
        cacheOutcome: 'skipped'
    };
}

// Cache check — returns fresh hits + list of sites needing live scrape
app.post('/api/check-availability', async (req, res) => {
    const { ean, compareWith = COMPARE_TARGET_SITES } = req.body;

    if (!ean) {
        return res.status(400).json({ error: 'ean is required' });
    }

    log('INFO', 'Cache check started', { ean, sites: compareWith });

    try {
        const { fresh, staleOrMissing } = await getCachedOffers(
            pool,
            ean,
            Array.isArray(compareWith) && compareWith.length ? compareWith : COMPARE_TARGET_SITES
        );

        const results = {};
        const requested = Array.isArray(compareWith) && compareWith.length ? compareWith : COMPARE_TARGET_SITES;
        for (const site of requested) {
            results[site] = fresh[site]
                ? formatSiteResult(fresh[site])
                : { exists: false, cachedPrice: null, productUrl: null, needsLiveScrape: true };
        }

        log('INFO', 'Cache check complete', {
            ean,
            freshCount: Object.keys(fresh).length,
            staleOrMissing
        });

        // Backward-compatible: flat site map at top level + metadata
        res.json({
            ean,
            results,
            staleOrMissing,
            ...results
        });
    } catch (err) {
        log('ERROR', 'Cache check failed', { ean, error: err.message });
        res.status(500).json({ error: 'Cache check failed' });
    }
});

// Live scrape with write-through cache
app.post('/api/live-compare', async (req, res) => {
    const { ean, targetSite, siteSettings, sourceProductName } = req.body;

    if (!ean || !targetSite) {
        return res.status(400).json({ error: 'ean and targetSite are required' });
    }

    log('INFO', 'Live scrape requested', {
        ean,
        targetSite,
        sourceProductName: sourceProductName || null,
        scraper: SCRAPER_BASE
    });

    try {
        const result = await processLiveCompare({
            ean,
            targetSite,
            siteSettings,
            sourceProductName
        });

        log('INFO', 'Scraper response received', {
            ean,
            targetSite,
            exists: result.exists,
            price: result.price,
            productUrl: result.productUrl
        });

        res.json({
            exists: result.exists,
            price: result.price,
            productUrl: result.productUrl,
            collectedAt: result.collectedAt,
            priceDropAlerts: result.priceDropAlerts || 0
        });
    } catch (err) {
        const details = formatScraperError(err);
        log('ERROR', 'Live scrape failed', { ean, targetSite, ...details });
        res.status(503).json({
            exists: false,
            error: details.message,
            code: details.code,
            scraper: SCRAPER_BASE
        });
    }
});

// Cache warm — fired by the content script while the user is still browsing the
// product page, so opening the popup hits a warm cache instead of a live scrape.
const warmInFlight = new Map();
const WARM_STALE_MS = 180000;
const WARM_JOIN_TIMEOUT_MS = 12000;

function siteSettingsFor(targetSite, clientSettings = {}) {
    return SITES_CONFIG[targetSite] || clientSettings[targetSite] || null;
}

async function runCacheWarm(ean, compareWith, sitesSettings, sourceProductName) {
    try {
        const { staleOrMissing } = await getCachedOffers(pool, ean, compareWith);

        if (staleOrMissing.length === 0) {
            log('INFO', 'Cache warm skipped — already fresh', { ean });
            return;
        }

        log('INFO', 'Cache warm started', { ean, sites: staleOrMissing });
        const startedAt = Date.now();

        await Promise.all(staleOrMissing.map(async (targetSite) => {
            const siteSettings = siteSettingsFor(targetSite, sitesSettings);
            if (!siteSettings?.searchUrlPattern) return;

            try {
                await processLiveCompare({ ean, targetSite, siteSettings, sourceProductName });
            } catch (err) {
                log('WARN', 'Cache warm scrape failed', {
                    ean,
                    targetSite,
                    error: formatScraperError(err).message
                });
            }
        }));

        log('INFO', 'Cache warm complete', { ean, elapsedMs: Date.now() - startedAt });
    } catch (err) {
        log('ERROR', 'Cache warm failed', { ean, error: err.message });
    } finally {
        warmInFlight.delete(ean);
    }
}

// Lets the popup ride on a warm that is already scraping this EAN instead of
// kicking off a duplicate scrape of the same sites.
async function joinInFlightWarm(ean, maxWaitMs) {
    const entry = warmInFlight.get(ean);
    if (!entry) return false;

    let timer = null;
    try {
        await Promise.race([
            entry.promise,
            new Promise((resolve) => { timer = setTimeout(resolve, maxWaitMs); })
        ]);
        return true;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

app.post('/api/compare-warm', (req, res) => {
    const {
        ean,
        compareWith = COMPARE_TARGET_SITES,
        sourceProductName = null,
        sitesSettings = {},
        sourceSite = null,
        sourceUrl = null,
        sourcePrice = null
    } = req.body || {};

    if (!ean) {
        return res.status(400).json({ error: 'ean is required' });
    }

    rememberOriginOffer({
        ean,
        sourceSite,
        sourceUrl,
        sourcePrice,
        sourceProductName
    }).catch(() => {});

    const now = Date.now();
    for (const [key, entry] of warmInFlight) {
        if (now - entry.startedAt > WARM_STALE_MS) warmInFlight.delete(key);
    }

    if (warmInFlight.has(ean)) {
        return res.status(202).json({ ean, warming: false, reason: 'already_warming' });
    }

    // Registered before starting so runCacheWarm's cleanup always has an entry.
    const entry = { startedAt: now, promise: null };
    warmInFlight.set(ean, entry);
    entry.promise = runCacheWarm(
        ean,
        Array.isArray(compareWith) && compareWith.length ? compareWith : COMPARE_TARGET_SITES,
        sitesSettings,
        sourceProductName
    );

    res.status(202).json({ ean, warming: true });
});

// SSE stream — cache hits first, then parallel live scrapes as each completes
app.post('/api/compare-stream', async (req, res) => {
    const {
        ean,
        compareWith = COMPARE_TARGET_SITES,
        sourceProductName,
        sitesSettings = {},
        sourceSite = null,
        sourcePrice = null,
        sourceUrl = null,
        installationId = null
    } = req.body;

    if (!ean) {
        return res.status(400).json({ error: 'ean is required' });
    }

    const requested = Array.isArray(compareWith) && compareWith.length
        ? compareWith
        : COMPARE_TARGET_SITES;
    const liveSites = requested;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }

    const send = (event, data) => {
        if (res.writableEnded) return;
        writeSSE(res, event, data);
    };

    const streamStartedAt = Date.now();
    log('INFO', 'Compare stream started', { ean, requested, liveSites, sourceSite });

    try {
        await rememberOriginOffer({
            ean,
            sourceSite,
            sourceUrl,
            sourcePrice,
            sourceProductName
        });

        if (warmInFlight.has(ean)) {
            log('INFO', 'Compare stream joining in-flight cache warm', { ean });
            await joinInFlightWarm(ean, WARM_JOIN_TIMEOUT_MS);
        }

        const { fresh, staleOrMissing } = await getCachedOffers(pool, ean, requested);
        const toScrape = staleOrMissing;

        const collected = [];
        let cacheHits = 0;
        let liveScrapes = 0;

        for (const site of requested) {
            if (fresh[site]) {
                cacheHits += 1;
                collected.push({
                    site,
                    price: fresh[site].cachedPrice,
                    fromCache: true
                });
                send('result', {
                    site,
                    ...formatSiteResult(fresh[site]),
                    fromCache: true
                });
            }
        }

        send('progress', {
            ean,
            cached: Object.keys(fresh).length,
            pending: toScrape.length
        });

        if (toScrape.length === 0) {
            recordCompareEvent(pool, {
                installationId,
                ean,
                sourceSite,
                sourcePrice,
                results: collected,
                cacheHits,
                liveScrapes
            }).catch((err) => log('ERROR', 'Compare analytics write failed', { error: err.message }));

            log('INFO', 'Compare stream complete (all cached)', {
                ean,
                elapsedMs: Date.now() - streamStartedAt,
                cacheHits
            });
            send('done', { ean, total: requested.length });
            res.end();
            return;
        }

        await Promise.all(toScrape.map(async (targetSite) => {
            const siteSettings = siteSettingsFor(targetSite, sitesSettings);
            if (!siteSettings?.searchUrlPattern) {
                send('error', {
                    site: targetSite,
                    exists: false,
                    error: 'Missing siteSettings for site',
                    code: 'BAD_REQUEST'
                });
                return;
            }

            try {
                liveScrapes += 1;
                const result = await processLiveCompare({
                    ean,
                    targetSite,
                    siteSettings,
                    sourceProductName
                });
                collected.push({
                    site: targetSite,
                    price: result.price,
                    fromCache: false
                });
                send('result', result);
            } catch (err) {
                const details = formatScraperError(err);
                log('ERROR', 'Stream scrape failed', { ean, targetSite, ...details });
                send('error', {
                    site: targetSite,
                    exists: false,
                    error: details.message,
                    code: details.code
                });
            }
        }));

        recordCompareEvent(pool, {
            installationId,
            ean,
            sourceSite,
            sourcePrice,
            results: collected,
            cacheHits,
            liveScrapes
        }).catch((err) => log('ERROR', 'Compare analytics write failed', { error: err.message }));

        log('INFO', 'Compare stream complete', {
            ean,
            elapsedMs: Date.now() - streamStartedAt,
            cacheHits,
            liveScrapes
        });
        send('done', { ean, total: requested.length });
        res.end();
    } catch (err) {
        log('ERROR', 'Compare stream failed', { ean, error: err.message });
        send('error', { error: err.message, code: 'STREAM_ERROR' });
        res.end();
    }
});

// Active / passive tracking
app.post('/api/track', async (req, res) => {
    try {
        const result = await trackProduct(pool, req.body);

        if (!result.accepted) {
            return res.status(202).json(result);
        }

        log('INFO', 'Product tracked', {
            ean: req.body.ean,
            source_site: req.body.source_site,
            tracking_type: req.body.tracking_type
        });

        res.json({ ok: true, ...result });
    } catch (err) {
        log('ERROR', 'Track failed', { error: err.message });
        res.status(err.status || 500).json({ error: err.message });
    }
});

// List tracked items for an installation
app.get('/api/track/:installationId', async (req, res) => {
    try {
        const items = await getUserTracker(pool, req.params.installationId);
        res.json({ items });
    } catch (err) {
        log('ERROR', 'Get tracker failed', { error: err.message });
        res.status(500).json({ error: 'Failed to load tracker' });
    }
});

// Opt out of active tracking (soft-delete — stops price-drop alerts)
app.put('/api/track/opt-out', async (req, res) => {
    try {
        const result = await optOutTracking(pool, req.body);

        if (!result.optedOut) {
            return res.status(404).json(result);
        }

        log('INFO', 'User opted out of tracking', {
            ean: req.body.ean,
            source_site: req.body.source_site || 'all',
            count: result.count
        });

        res.json({ ok: true, ...result });
    } catch (err) {
        log('ERROR', 'Opt-out failed', { error: err.message });
        res.status(err.status || 500).json({ error: err.message });
    }
});

// ---------- Price-drop watchlist (tracked_items) ----------

// Add a product to the watchlist
app.post('/api/alerts', async (req, res) => {
    try {
        const item = await addTrackedItem(pool, req.body || {});
        log('INFO', 'Tracked item saved', { id: item.id, ean: item.ean });
        res.status(201).json({ ok: true, item });
    } catch (err) {
        if (err instanceof TrackedItemError) {
            return res.status(err.status).json({ error: err.message });
        }
        log('ERROR', 'Add tracked item failed', { error: err.message });
        res.status(500).json({ error: 'Failed to save tracked item' });
    }
});

// List the watchlist. ?droppedOnly=1 returns only items whose price fell.
app.get('/api/alerts/:userId', async (req, res) => {
    try {
        const droppedOnly = ['1', 'true'].includes(String(req.query.droppedOnly));
        const items = await listTrackedItems(pool, req.params.userId, { droppedOnly });
        res.json({ items, droppedCount: items.filter(item => item.hasDropped).length });
    } catch (err) {
        if (err instanceof TrackedItemError) {
            return res.status(err.status).json({ error: err.message });
        }
        log('ERROR', 'List tracked items failed', { error: err.message });
        res.status(500).json({ error: 'Failed to load tracked items' });
    }
});

// Remove a product from the watchlist
app.delete('/api/alerts/:id', async (req, res) => {
    const userId = req.body?.userId || req.query.userId;

    try {
        const result = await deleteTrackedItem(pool, req.params.id, userId);
        res.json({ ok: true, ...result });
    } catch (err) {
        if (err instanceof TrackedItemError) {
            return res.status(err.status).json({ error: err.message });
        }
        log('ERROR', 'Delete tracked item failed', { error: err.message });
        res.status(500).json({ error: 'Failed to delete tracked item' });
    }
});

// Check if a specific product is already tracked
app.get('/api/track/:installationId/:ean/:sourceSite', async (req, res) => {
    try {
        const row = await isTracked(
            pool,
            req.params.installationId,
            req.params.ean,
            req.params.sourceSite
        );
        res.json({ tracked: Boolean(row), ...row });
    } catch (err) {
        log('ERROR', 'Track status check failed', { error: err.message });
        res.status(500).json({ error: 'Failed to check track status' });
    }
});

// ---------- Registration (Phase 1) ----------
app.get('/api/questions', async (_req, res) => {
    try {
        const questions = await getActiveQuestions(pool);
        res.json({ questions });
    } catch (err) {
        log('ERROR', 'Get questions failed', { error: formatDbError(err), code: err.code });
        res.status(503).json({ questions: [] });
    }
});

app.get('/api/clubs', async (_req, res) => {
    try {
        const clubs = await listClubs(pool);
        res.json({ clubs });
    } catch (err) {
        log('ERROR', 'Get clubs failed', { error: formatDbError(err), code: err.code });
        res.status(503).json({ clubs: [] });
    }
});

// Club badges shown next to each retail site in the extension
app.get('/api/site-clubs', async (_req, res) => {
    try {
        const siteClubs = await getSiteClubsMap(pool);
        res.json({ siteClubs });
    } catch (err) {
        log('ERROR', 'Site clubs lookup failed', { error: formatDbError(err) });
        res.status(503).json({ siteClubs: {} });
    }
});

app.get('/api/users/status', async (req, res) => {
    const installationId = req.query.installationId;
    if (!installationId) {
        return res.status(400).json({ error: 'installationId query param is required' });
    }

    try {
        const status = await getRegistrationStatus(pool, installationId);
        res.json(status);
    } catch (err) {
        log('ERROR', 'Registration status failed', { error: formatDbError(err), code: err.code });
        res.status(503).json({
            registered: false,
            error: formatDbError(err)
        });
    }
});

app.post('/api/users/register', async (req, res) => {
    try {
        const user = await registerUser(pool, {
            installationId: req.body.installationId,
            email: req.body.email,
            consumerClubs: req.body.consumerClubs,
            country: req.body.country,
            dynamicAnswers: req.body.dynamicAnswers,
            extensionVersion: req.body.extensionVersion,
            locale: req.body.locale,
            platform: req.body.platform
        });

        log('INFO', 'User registered', { userId: user.id, email: user.email });
        res.status(201).json({ ok: true, user });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Email already registered' });
        }
        log('ERROR', 'Registration failed', { error: formatDbError(err), code: err.code });
        res.status(err.status || 503).json({ error: formatDbError(err) });
    }
});

// Personal area: replace the user's consumer club selection
app.put('/api/users/:installationId/clubs', async (req, res) => {
    try {
        const user = await updateConsumerClubs(
            pool,
            req.params.installationId,
            req.body?.consumerClubs
        );

        log('INFO', 'Consumer clubs updated', {
            userId: user.id,
            clubs: user.consumerClubs.length
        });
        res.json({ ok: true, user });
    } catch (err) {
        log('ERROR', 'Consumer clubs update failed', { error: err.message });
        res.status(err.status || 500).json({ error: err.message });
    }
});

// Extension / origin writes: persist a confirmed product URL without scraping.
app.post('/api/offers', async (req, res) => {
    const { ean, siteKey, productUrl, price, productName } = req.body || {};
    if (!ean || !siteKey || !productUrl) {
        return res.status(400).json({ error: 'ean, siteKey and productUrl are required' });
    }

    const resolvedKey = resolveSiteEntry(siteKey)?.key || siteKey;
    const num = Number(price);
    const hasPrice = Number.isFinite(num) && num > 0;

    try {
        await upsertOffer(pool, {
            ean,
            siteKey: resolvedKey,
            productUrl,
            price: hasPrice ? num : null,
            outcome: hasPrice ? 'found' : 'partial',
            productName: productName || null
        });
        log('INFO', 'Offer upserted from client', { ean, siteKey: resolvedKey, hasPrice });
        res.json({ ok: true, siteKey: resolvedKey });
    } catch (err) {
        log('ERROR', 'Client offer upsert failed', { ean, siteKey: resolvedKey, error: err.message });
        res.status(500).json({ error: 'Failed to save offer' });
    }
});

app.get('/api/offers/:ean', async (req, res) => {
    try {
        const site = req.query.site;
        if (site) {
            const siteKey = resolveSiteEntry(site)?.key || site;
            const offer = await getUsableCachedOffer(pool, req.params.ean, siteKey);
            return res.json({ ean: req.params.ean, site: siteKey, offer });
        }

        const requested = COMPARE_TARGET_SITES;
        const { fresh } = await getCachedOffers(pool, req.params.ean, requested);
        res.json({ ean: req.params.ean, fresh });
    } catch (err) {
        log('ERROR', 'Offer lookup failed', { ean: req.params.ean, error: err.message });
        res.status(500).json({ error: 'Failed to load offers' });
    }
});

// ---------- Admin (Phase 2) — all routes behind verifyAdmin ----------
const adminRouter = express.Router();
adminRouter.use(verifyAdmin);

adminRouter.get('/ping', (req, res) => {
    res.json({ ok: true, adminId: req.adminUser.id, email: req.adminUser.email });
});

adminRouter.get('/stats', async (_req, res) => {
    try {
        const stats = await getUserStats(pool);
        res.json(stats);
    } catch (err) {
        log('ERROR', 'Admin stats failed', { error: formatDbError(err), code: err.code });
        res.status(503).json({ error: formatDbError(err) });
    }
});

adminRouter.get('/health', async (_req, res) => {
    try {
        const health = await getLiveHealth(pool, checkScraperHealth);
        res.status(health.ok ? 200 : 503).json(health);
    } catch (err) {
        log('ERROR', 'Admin health failed', { error: formatDbError(err), code: err.code });
        res.status(503).json({ error: formatDbError(err) });
    }
});

adminRouter.get('/health-logs', async (req, res) => {
    try {
        const logs = await getHealthLogs(pool, req.query.limit);
        res.json({
            logs,
            running: isHealthCheckRunning()
        });
    } catch (err) {
        log('ERROR', 'Admin health logs failed', { error: formatDbError(err), code: err.code });
        res.status(503).json({ error: formatDbError(err) });
    }
});

adminRouter.post('/health-check', async (_req, res) => {
    try {
        const result = await runSelectorHealthChecks(pool, log);
        if (result.skipped) {
            return res.status(409).json({ error: result.reason, skipped: true });
        }
        res.json(result);
    } catch (err) {
        log('ERROR', 'Admin selector health check failed', { error: formatDbError(err), code: err.code });
        res.status(503).json({ error: formatDbError(err) });
    }
});

adminRouter.get('/site-clubs', async (_req, res) => {
    try {
        const [siteClubs, clubs] = await Promise.all([
            getSiteClubsMap(pool),
            listClubs(pool)
        ]);
        res.json({ sites: listRetailSites(), clubs, siteClubs });
    } catch (err) {
        log('ERROR', 'Admin site clubs failed', { error: formatDbError(err), code: err.code });
        res.status(503).json({ error: formatDbError(err) });
    }
});

adminRouter.put('/site-clubs/:siteKey', async (req, res) => {
    try {
        const result = await setSiteClubs(pool, req.params.siteKey, req.body?.clubIds);
        log('INFO', 'Site clubs updated', {
            siteKey: result.siteKey,
            clubs: result.clubs.length
        });
        res.json({ ok: true, ...result });
    } catch (err) {
        log('ERROR', 'Admin site clubs update failed', { error: formatDbError(err), code: err.code });
        res.status(err.status || 503).json({ error: formatDbError(err) });
    }
});

attachAdminCatalogRoutes(adminRouter, pool, {
    log,
    formatDbError,
    listClubs,
    createClub,
    deleteClub,
    listAllQuestions,
    createQuestion,
    updateQuestion,
    deleteQuestion
});

app.use('/api/admin', adminRouter);

// Health check (DB + scraper)
app.get('/api/health', async (_req, res) => {
    let dbOk = false;
    let dbError = null;

    try {
        await pool.query('SELECT 1');
        dbOk = true;
    } catch (err) {
        dbError = err.message;
    }

    const scraper = await checkScraperHealth();

    const ok = dbOk && scraper.ok;
    res.status(ok ? 200 : 503).json({
        ok,
        db: dbOk ? 'connected' : dbError,
        scraper
    });
});

// Daily price watch: once shortly after boot, then every 24 hours. The boot run
// is delayed so the scraper cluster has time to come up first.
const PRICE_WATCH_INTERVAL_MS = Number(process.env.PRICE_WATCH_INTERVAL_MS || 24 * 60 * 60 * 1000);
const PRICE_WATCH_BOOT_DELAY_MS = Number(process.env.PRICE_WATCH_BOOT_DELAY_MS || 30000);

function schedulePriceWatch() {
    const trigger = (reason) => {
        if (isPriceWatchRunning()) {
            log('INFO', 'Price watch skipped — previous run still active', { reason });
            return;
        }
        log('INFO', 'Price watch triggered', { reason });
        runPriceWatch(pool, processLiveCompare, log).catch((err) => {
            log('ERROR', 'Price watch crashed', { error: err.message });
        });
    };

    setTimeout(() => trigger('startup'), PRICE_WATCH_BOOT_DELAY_MS);
    setInterval(() => trigger('daily'), PRICE_WATCH_INTERVAL_MS);
}

app.listen(port, () => {
    console.log(`🚀 Server Running: http://localhost:${port}`);
    console.log('Ready to accept requests from Extension...');
    schedulePriceWatch();
});
