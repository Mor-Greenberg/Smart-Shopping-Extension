const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PRICE = 100000;

class TrackedItemError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

function toPrice(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0 || num >= MAX_PRICE) return null;
    return Math.round(num * 100) / 100;
}

function toHttpUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const parsed = new URL(value.trim());
        return /^https?:$/.test(parsed.protocol) ? parsed.toString() : null;
    } catch (_) {
        return null;
    }
}

function toText(value, maxLength) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, maxLength) : null;
}

/**
 * The extension holds an installation UUID while the DB keys rows by users.id,
 * so accept either and resolve to the canonical users.id.
 */
async function resolveUserId(pool, userKey) {
    if (typeof userKey !== 'string' || !UUID_RE.test(userKey.trim())) {
        throw new TrackedItemError('A valid userId is required', 400);
    }

    const { rows } = await pool.query(
        `SELECT id FROM users WHERE id = $1::uuid OR installation_id = $1::uuid LIMIT 1`,
        [userKey.trim()]
    );

    if (!rows[0]) {
        throw new TrackedItemError('Unknown user', 404);
    }
    return rows[0].id;
}

function mapRow(row) {
    return {
        id: Number(row.id),
        ean: row.ean,
        siteKey: row.site_key,
        productUrl: row.product_url,
        productName: row.product_name,
        imageUrl: row.image_url,
        originalPrice: Number(row.original_price),
        currentPrice: row.current_price === null ? null : Number(row.current_price),
        hasDropped: row.has_dropped,
        bestOfferUrl: row.best_offer_url,
        bestOfferSite: row.best_offer_site,
        lastCheckedAt: row.last_checked_at,
        createdAt: row.created_at
    };
}

// A watchlist row is one product. When the same barcode is saved again from a
// different retailer we keep the cheapest listing as the baseline, so the user
// is never alerted about a "drop" to a price they could already beat.
const UPSERT_BY_EAN = `
    INSERT INTO tracked_items
        (user_id, ean, site_key, product_url, product_name, image_url,
         original_price, current_price, has_dropped)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $7, FALSE)
    ON CONFLICT (user_id, ean) WHERE ean IS NOT NULL DO UPDATE SET
        site_key = CASE
            WHEN EXCLUDED.original_price < tracked_items.original_price
            THEN EXCLUDED.site_key ELSE tracked_items.site_key END,
        product_url = CASE
            WHEN EXCLUDED.original_price < tracked_items.original_price
            THEN EXCLUDED.product_url ELSE tracked_items.product_url END,
        product_name   = COALESCE(EXCLUDED.product_name, tracked_items.product_name),
        image_url      = COALESCE(EXCLUDED.image_url, tracked_items.image_url),
        original_price = LEAST(tracked_items.original_price, EXCLUDED.original_price),
        current_price  = LEAST(
            COALESCE(tracked_items.current_price, EXCLUDED.original_price),
            EXCLUDED.original_price
        ),
        has_dropped = LEAST(
            COALESCE(tracked_items.current_price, EXCLUDED.original_price),
            EXCLUDED.original_price
        ) < LEAST(tracked_items.original_price, EXCLUDED.original_price),
        updated_at = NOW()
    RETURNING *`;

// Items with no barcode cannot be matched across retailers, so the listing URL
// stays their identity.
const UPSERT_BY_URL = `
    INSERT INTO tracked_items
        (user_id, ean, site_key, product_url, product_name, image_url,
         original_price, current_price, has_dropped)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $7, FALSE)
    ON CONFLICT (user_id, product_url) WHERE ean IS NULL DO UPDATE SET
        site_key        = COALESCE(EXCLUDED.site_key, tracked_items.site_key),
        product_name    = COALESCE(EXCLUDED.product_name, tracked_items.product_name),
        image_url       = COALESCE(EXCLUDED.image_url, tracked_items.image_url),
        original_price  = EXCLUDED.original_price,
        current_price   = EXCLUDED.original_price,
        has_dropped     = FALSE,
        best_offer_url  = NULL,
        best_offer_site = NULL,
        updated_at      = NOW()
    RETURNING *`;

async function addTrackedItem(pool, payload = {}) {
    const {
        userId,
        url,
        name,
        image,
        originalPrice,
        ean = null,
        siteKey = null
    } = payload;

    const resolvedUserId = await resolveUserId(pool, userId);
    const productUrl = toHttpUrl(url);
    const price = toPrice(originalPrice);

    if (!productUrl) {
        throw new TrackedItemError('A valid http(s) product url is required', 400);
    }
    if (price === null) {
        throw new TrackedItemError('originalPrice must be a positive number', 400);
    }

    const normalizedEan = toText(ean, 14);

    const { rows } = await pool.query(
        normalizedEan ? UPSERT_BY_EAN : UPSERT_BY_URL,
        [
            resolvedUserId,
            normalizedEan,
            toText(siteKey, 128),
            productUrl,
            toText(name, 500),
            toHttpUrl(image),
            price
        ]
    );

    return mapRow(rows[0]);
}

async function listTrackedItems(pool, userKey, { droppedOnly = false } = {}) {
    const resolvedUserId = await resolveUserId(pool, userKey);

    const { rows } = await pool.query(
        `SELECT * FROM tracked_items
         WHERE user_id = $1
           AND ($2::boolean = FALSE OR has_dropped = TRUE)
         ORDER BY has_dropped DESC, updated_at DESC`,
        [resolvedUserId, Boolean(droppedOnly)]
    );

    return rows.map(mapRow);
}

/**
 * userKey is required so one installation cannot delete another user's rows.
 */
async function deleteTrackedItem(pool, id, userKey) {
    const itemId = Number(id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
        throw new TrackedItemError('A valid item id is required', 400);
    }

    const resolvedUserId = await resolveUserId(pool, userKey);

    const { rowCount } = await pool.query(
        `DELETE FROM tracked_items WHERE id = $1 AND user_id = $2`,
        [itemId, resolvedUserId]
    );

    if (!rowCount) {
        throw new TrackedItemError('Tracked item not found', 404);
    }
    return { deleted: true, id: itemId };
}

async function countDropped(pool, userKey) {
    const resolvedUserId = await resolveUserId(pool, userKey);
    const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM tracked_items
         WHERE user_id = $1 AND has_dropped = TRUE`,
        [resolvedUserId]
    );
    return rows[0].count;
}

/**
 * Distinct EANs the daily watch needs to re-scrape.
 */
async function getWatchableEans(pool) {
    const { rows } = await pool.query(
        `SELECT ean,
                MAX(product_name) AS product_name,
                COUNT(*)::int     AS item_count
         FROM tracked_items
         WHERE ean IS NOT NULL AND ean <> ''
         GROUP BY ean
         ORDER BY item_count DESC`
    );
    return rows;
}

/**
 * Applies the freshest market price to every watchlist row for one EAN.
 * has_dropped latches on any price below the price the user saved at, and the
 * cheapest offer is stored separately so the card can link to the retailer that
 * actually has the deal.
 */
async function applyPriceCheck(pool, ean, { price, productUrl = null, siteKey = null }) {
    const newPrice = toPrice(price);
    if (!ean || newPrice === null) {
        return { updated: 0, dropped: 0 };
    }

    const { rows } = await pool.query(
        `UPDATE tracked_items
         SET current_price   = $2,
             has_dropped     = ($2 < original_price),
             best_offer_url  = CASE WHEN $2 < original_price THEN $3 ELSE NULL END,
             best_offer_site = CASE WHEN $2 < original_price THEN $4 ELSE NULL END,
             last_checked_at = NOW(),
             updated_at      = NOW()
         WHERE ean = $1
         RETURNING has_dropped`,
        [ean, newPrice, toHttpUrl(productUrl), toText(siteKey, 128)]
    );

    return {
        updated: rows.length,
        dropped: rows.filter(row => row.has_dropped).length
    };
}

module.exports = {
    TrackedItemError,
    addTrackedItem,
    listTrackedItems,
    deleteTrackedItem,
    countDropped,
    getWatchableEans,
    applyPriceCheck
};
