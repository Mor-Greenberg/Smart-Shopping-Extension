-- TrackedItems: the user-facing price-drop watchlist.
--
-- Separate from user_tracker on purpose: user_tracker records browsing
-- behaviour for analytics, while tracked_items is the explicit watchlist the
-- user manages from the alerts page.
--
-- ean / site_key are not in the original spec but are stored so the daily watch
-- can reuse the existing compare pipeline and spot a cheaper price at ANY
-- retailer, not just re-read the URL the item was saved from.

BEGIN;

CREATE TABLE IF NOT EXISTS tracked_items (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ean             VARCHAR(14),
    site_key        VARCHAR(128),
    product_url     TEXT NOT NULL,
    product_name    TEXT,
    image_url       TEXT,
    original_price  NUMERIC(10,2) NOT NULL,
    current_price   NUMERIC(10,2),
    has_dropped     BOOLEAN NOT NULL DEFAULT FALSE,
    best_offer_url  TEXT,
    best_offer_site VARCHAR(128),
    last_checked_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tracked_items_original_price_chk
        CHECK (original_price > 0 AND original_price < 100000),
    CONSTRAINT tracked_items_current_price_chk
        CHECK (current_price IS NULL OR (current_price > 0 AND current_price < 100000))
);

-- One watchlist row per product per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracked_items_user_url
    ON tracked_items (user_id, product_url);

-- Badge count query.
CREATE INDEX IF NOT EXISTS idx_tracked_items_dropped
    ON tracked_items (user_id, has_dropped)
    WHERE has_dropped = TRUE;

-- Daily watch groups work by EAN.
CREATE INDEX IF NOT EXISTS idx_tracked_items_ean
    ON tracked_items (ean)
    WHERE ean IS NOT NULL;

COMMIT;
