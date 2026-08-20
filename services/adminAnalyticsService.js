async function getUserStats(pool) {
    const total = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM users
         WHERE registered_at IS NOT NULL`
    );

    const byCountry = await pool.query(
        `SELECT COALESCE(country, 'unknown') AS country, COUNT(*)::int AS count
         FROM users
         WHERE registered_at IS NOT NULL
         GROUP BY COALESCE(country, 'unknown')
         ORDER BY count DESC`
    );

    const activeQ = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM dynamic_questions
         WHERE is_active = TRUE`
    );

    // Driven by consumer_clubs so the panel mirrors the clubs the admin manages —
    // legacy selections that no longer exist as a club are not counted.
    const clubs = await pool.query(
        `SELECT c.name AS club, COUNT(u.id)::int AS count
         FROM consumer_clubs c
         LEFT JOIN users u
           ON u.registered_at IS NOT NULL
          AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(
                  COALESCE(u.consumer_clubs, '[]'::jsonb)
              ) AS sel(val)
              WHERE LOWER(TRIM(sel.val)) = LOWER(c.name)
          )
         GROUP BY c.id, c.name
         ORDER BY count DESC, c.name ASC`
    );

    const answers = await pool.query(
        `SELECT
            q.id,
            q.question_text,
            COUNT(*) FILTER (
                WHERE NULLIF(u.dynamic_answers ->> q.id::text, '') IS NOT NULL
            )::int AS answered_count
         FROM dynamic_questions q
         LEFT JOIN users u ON u.registered_at IS NOT NULL
         GROUP BY q.id, q.question_text
         ORDER BY q.id ASC`
    );

    let searchRow = {
        total_searches: 0,
        successful_searches: 0,
        cache_hits: 0,
        compare_saved: 0
    };
    let dropsSaved = 0;
    let topSaverRows = [];

    try {
        const searches = await pool.query(
            `SELECT
                COUNT(*)::int AS total_searches,
                COUNT(*) FILTER (WHERE found_cheaper)::int AS successful_searches,
                COALESCE(SUM(cache_hits), 0)::int AS cache_hits,
                COALESCE(SUM(saved_amount), 0)::numeric AS compare_saved
             FROM compare_events`
        );
        searchRow = searches.rows[0];
    } catch (err) {
        if (err.code !== '42P01') throw err;
    }

    try {
        const alertSaved = await pool.query(
            `SELECT COALESCE(SUM(drop_amount), 0)::numeric AS saved
             FROM price_drop_alerts`
        );
        dropsSaved = Number(alertSaved.rows[0].saved || 0);
    } catch (err) {
        if (err.code !== '42P01') throw err;
    }

    try {
        const topSavers = await pool.query(
            `SELECT
                COALESCE(NULLIF(u.email, ''), u.installation_id::text) AS email,
                SUM(x.saved)::numeric AS saved
             FROM (
                SELECT user_id, saved_amount AS saved
                FROM compare_events
                WHERE saved_amount > 0 AND user_id IS NOT NULL
                UNION ALL
                SELECT user_id, drop_amount AS saved
                FROM price_drop_alerts
                WHERE drop_amount > 0
             ) x
             JOIN users u ON u.id = x.user_id
             WHERE NULLIF(u.email, '') IS NOT NULL
             GROUP BY 1
             ORDER BY saved DESC
             LIMIT 8`
        );
        topSaverRows = topSavers.rows;
    } catch (err) {
        if (err.code !== '42P01') throw err;
    }

    const compareSaved = Number(searchRow.compare_saved || 0);

    return {
        totalUsers: total.rows[0].total,
        activeQuestions: activeQ.rows[0].count,
        usersByCountry: byCountry.rows,
        topConsumerClubs: clubs.rows,
        questionAnswers: answers.rows,
        successfulSearches: searchRow.successful_searches,
        totalSearches: searchRow.total_searches,
        cacheHits: searchRow.cache_hits,
        totalMoneySaved: Math.round((compareSaved + dropsSaved) * 100) / 100,
        topSavers: topSaverRows.map((row) => ({
            email: row.email,
            saved: Number(row.saved || 0)
        }))
    };
}

async function getHealthLogs(pool, limit = 50) {
    const { rows } = await pool.query(
        `SELECT id, check_type, site_key, status, message, latency_ms, created_at
         FROM health_logs
         ORDER BY created_at DESC
         LIMIT $1`,
        [Math.min(Number(limit) || 50, 200)]
    );
    return rows;
}

async function getLiveHealth(pool, checkScraperHealth) {
    const started = Date.now();
    let dbOk = false;
    let dbError = null;
    let dbLatencyMs = null;

    try {
        await pool.query('SELECT 1');
        dbOk = true;
        dbLatencyMs = Date.now() - started;
    } catch (err) {
        dbError = err.message || err.code || 'DB error';
        dbLatencyMs = Date.now() - started;
    }

    const scraperStarted = Date.now();
    const scraper = await checkScraperHealth();
    const scraperLatencyMs = Date.now() - scraperStarted;

    return {
        ok: dbOk && scraper.ok,
        db: {
            ok: dbOk,
            error: dbError,
            latencyMs: dbLatencyMs
        },
        scraper: {
            ...scraper,
            latencyMs: scraperLatencyMs
        }
    };
}

module.exports = {
    getUserStats,
    getHealthLogs,
    getLiveHealth
};
