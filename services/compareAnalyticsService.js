async function recordCompareEvent(pool, {
    installationId = null,
    ean,
    sourceSite = null,
    sourcePrice = null,
    results = [],
    cacheHits = 0,
    liveScrapes = 0
}) {
    if (!ean) return null;

    let userId = null;
    if (installationId) {
        const { rows } = await pool.query(
            `SELECT id FROM users WHERE installation_id = $1 LIMIT 1`,
            [installationId]
        );
        userId = rows[0]?.id || null;
    }

    const priced = (results || [])
        .map((r) => ({
            site: r.site,
            price: r.price != null ? Number(r.price) : null
        }))
        .filter((r) => Number.isFinite(r.price) && r.price > 0);

    const cheapest = priced.length
        ? priced.reduce((a, b) => (b.price < a.price ? b : a))
        : null;

    const srcPrice = sourcePrice != null ? Number(sourcePrice) : null;
    const foundCheaper = Boolean(
        Number.isFinite(srcPrice) && srcPrice > 0 && cheapest && cheapest.price < srcPrice
    );
    const savedAmount = foundCheaper
        ? Math.round((srcPrice - cheapest.price) * 100) / 100
        : 0;

    await pool.query(
        `INSERT INTO compare_events (
            user_id, installation_id, ean, source_site, source_price,
            cheapest_price, cheapest_site, saved_amount, found_cheaper,
            cache_hits, live_scrapes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
            userId,
            installationId || null,
            ean,
            sourceSite || null,
            Number.isFinite(srcPrice) ? srcPrice : null,
            cheapest ? cheapest.price : null,
            cheapest ? cheapest.site : null,
            savedAmount,
            foundCheaper,
            Number(cacheHits) || 0,
            Number(liveScrapes) || 0
        ]
    );
}

module.exports = { recordCompareEvent };
