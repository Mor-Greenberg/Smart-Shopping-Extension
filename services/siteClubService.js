const { SITES_CONFIG, isSiteEnabled } = require('../config');

function initialsFrom(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'CL';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Retail sites are defined in config.js, so that stays the source of truth for
 * which keys may be mapped. Anything else is rejected rather than silently
 * stored against a site that does not exist.
 */
function listRetailSites() {
    return Object.keys(SITES_CONFIG)
        .filter((key) => {
            const cfg = SITES_CONFIG[key];
            return cfg?.siteType === 'retail' && isSiteEnabled(cfg);
        })
        .map((key) => ({
            key,
            name: SITES_CONFIG[key].displayName || SITES_CONFIG[key].name || key
        }));
}

function isKnownSite(siteKey) {
    return listRetailSites().some((site) => site.key === siteKey);
}

async function getSiteClubsMap(pool) {
    const { rows } = await pool.query(
        `SELECT sc.site_key, c.id, c.name, c.logo_url
         FROM site_consumer_clubs sc
         JOIN consumer_clubs c ON c.id = sc.club_id
         ORDER BY sc.site_key ASC, c.name ASC`
    );

    const map = {};
    for (const row of rows) {
        if (!map[row.site_key]) map[row.site_key] = [];
        map[row.site_key].push({
            id: row.id,
            name: row.name,
            logoUrl: row.logo_url || null,
            initials: initialsFrom(row.name)
        });
    }
    return map;
}

async function setSiteClubs(pool, siteKey, clubIds) {
    const key = String(siteKey || '').trim();

    if (!isKnownSite(key)) {
        const err = new Error('Unknown retail site');
        err.status = 400;
        throw err;
    }

    if (!Array.isArray(clubIds)) {
        const err = new Error('clubIds must be an array');
        err.status = 400;
        throw err;
    }

    const ids = [...new Set(
        clubIds.map(Number).filter(id => Number.isInteger(id) && id > 0)
    )];

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM site_consumer_clubs WHERE site_key = $1', [key]);

        if (ids.length) {
            // Unknown ids are dropped by the join against consumer_clubs.
            await client.query(
                `INSERT INTO site_consumer_clubs (site_key, club_id)
                 SELECT $1, c.id FROM consumer_clubs c WHERE c.id = ANY($2::int[])
                 ON CONFLICT DO NOTHING`,
                [key, ids]
            );
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    const map = await getSiteClubsMap(pool);
    return { siteKey: key, clubs: map[key] || [] };
}

module.exports = {
    listRetailSites,
    getSiteClubsMap,
    setSiteClubs
};
