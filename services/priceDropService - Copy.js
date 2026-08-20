async function getExistingOffer(pool, ean, siteKey) {
    const { rows } = await pool.query(
        `SELECT price, product_url, exists_on_site
         FROM product_site_offers
         WHERE ean = $1 AND site_key = $2`,
        [ean, siteKey]
    );
    return rows[0] || null;
}

async function getLowestActivePriceForEan(pool, ean) {
    const { rows } = await pool.query(
        `SELECT site_key, price, product_url
         FROM product_site_offers
         WHERE ean = $1 AND exists_on_site = TRUE AND price > 0
         ORDER BY price ASC
         LIMIT 1`,
        [ean]
    );
    return rows[0] || null;
}

/**
 * Compare new scrape price against cache history and per-user baseline.
 * Creates price_drop_alerts only for users with tracking_type = 'active'.
 */
async function processPriceDropAlerts(pool, {
    ean,
    siteKey,
    newPrice,
    productUrl,
    productName,
    previousPrice: previousPriceInput = null,
    previousProductUrl = null
}) {
    if (!ean || !siteKey || !(newPrice > 0)) {
        return { alertsCreated: 0, skipped: 'invalid_price' };
    }

    let previousPrice = previousPriceInput;
    let cachedUrl = previousProductUrl;

    if (previousPrice === null) {
        const previousOffer = await getExistingOffer(pool, ean, siteKey);
        previousPrice = previousOffer?.price ? Number(previousOffer.price) : null;
        cachedUrl = previousOffer?.product_url || null;
    }

    if (previousPrice !== null && Number(newPrice) >= previousPrice) {
        return { alertsCreated: 0, skipped: 'no_drop_vs_cache', previousPrice, newPrice };
    }

    const { rows: activeTrackers } = await pool.query(
        `SELECT ut.id AS tracker_id,
                ut.user_id,
                ut.baseline_price,
                ut.baseline_site_key,
                ut.product_name,
                u.installation_id
         FROM user_tracker ut
         JOIN users u ON u.id = ut.user_id
         WHERE ut.ean = $1
           AND ut.tracking_type = 'active'
           AND ut.is_active = TRUE`,
        [ean]
    );

    if (!activeTrackers.length) {
        return { alertsCreated: 0, skipped: 'no_active_trackers', previousPrice, newPrice };
    }

    let alertsCreated = 0;
    const dropVsCache = previousPrice !== null ? previousPrice - Number(newPrice) : null;

    for (const tracker of activeTrackers) {
        const baseline = tracker.baseline_price ? Number(tracker.baseline_price) : null;
        const referencePrice = baseline ?? previousPrice;

        if (referencePrice === null) continue;
        if (Number(newPrice) >= referencePrice) continue;

        const dropAmount = referencePrice - Number(newPrice);

        await pool.query(
            `INSERT INTO price_drop_alerts
                (user_id, ean, site_key, old_price, new_price, drop_amount,
                 product_url, product_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                tracker.user_id,
                ean,
                siteKey,
                referencePrice,
                newPrice,
                dropAmount,
                productUrl || cachedUrl || null,
                productName || tracker.product_name || null
            ]
        );

        // Move the baseline down to the price we just alerted on, otherwise the
        // daily watch would re-report the same drop on every run. Guarded so two
        // sites dropping in the same run settle on the lower of the two.
        await pool.query(
            `UPDATE user_tracker
             SET baseline_price = $1, baseline_site_key = $2
             WHERE id = $3
               AND (baseline_price IS NULL OR baseline_price > $1)`,
            [newPrice, siteKey, tracker.tracker_id]
        );

        alertsCreated++;
    }

    return {
        alertsCreated,
        previousPrice,
        newPrice,
        dropVsCache,
        activeTrackerCount: activeTrackers.length
    };
}

async function getUnreadAlerts(pool, installationId) {
    const { rows } = await pool.query(
        `SELECT a.id, a.ean, a.site_key, a.old_price, a.new_price, a.drop_amount,
                a.product_url, a.product_name, a.created_at
         FROM price_drop_alerts a
         JOIN users u ON u.id = a.user_id
         WHERE u.installation_id = $1
           AND a.is_read = FALSE
         ORDER BY a.created_at DESC`,
        [installationId]
    );
    return rows;
}

async function markAlertsRead(pool, installationId, alertIds = null) {
    const ids = Array.isArray(alertIds) && alertIds.length
        ? alertIds.map(Number).filter(Number.isFinite)
        : null;

    const { rowCount } = await pool.query(
        `UPDATE price_drop_alerts a
         SET is_read = TRUE
         FROM users u
         WHERE a.user_id = u.id
           AND u.installation_id = $1
           AND a.is_read = FALSE
           AND ($2::bigint[] IS NULL OR a.id = ANY($2::bigint[]))`,
        [installationId, ids]
    );

    return { updated: rowCount };
}

module.exports = {
    getExistingOffer,
    getLowestActivePriceForEan,
    processPriceDropAlerts,
    getUnreadAlerts,
    markAlertsRead
};
