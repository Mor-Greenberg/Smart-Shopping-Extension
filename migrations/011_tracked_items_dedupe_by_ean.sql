-- A watchlist entry is one product, not one listing.
--
-- 010 keyed rows by (user_id, product_url), so tracking the same barcode at
-- three retailers produced three alerts for what is really one product. The key
-- moves to (user_id, ean); product_url falls back to being the key only for the
-- rare item that has no barcode.

BEGIN;

-- '' is not NULL, so it would slip past the partial index below.
UPDATE tracked_items SET ean = NULL WHERE ean = '';

-- Collapse existing duplicates, keeping the cheapest baseline per product.
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY user_id, ean
               ORDER BY original_price ASC, id ASC
           ) AS rn
    FROM tracked_items
    WHERE ean IS NOT NULL
)
DELETE FROM tracked_items ti
USING ranked r
WHERE ti.id = r.id
  AND r.rn > 1;

DROP INDEX IF EXISTS idx_tracked_items_user_url;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tracked_items_user_ean
    ON tracked_items (user_id, ean)
    WHERE ean IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tracked_items_user_url
    ON tracked_items (user_id, product_url)
    WHERE ean IS NULL;

COMMIT;
