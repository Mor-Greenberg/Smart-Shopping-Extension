-- Compare sessions for real Overview analytics

BEGIN;

CREATE TABLE IF NOT EXISTS compare_events (
    id               BIGSERIAL PRIMARY KEY,
    user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
    installation_id  UUID,
    ean              VARCHAR(14) NOT NULL,
    source_site      VARCHAR(128),
    source_price     NUMERIC(10,2),
    cheapest_price   NUMERIC(10,2),
    cheapest_site    VARCHAR(128),
    saved_amount     NUMERIC(10,2) NOT NULL DEFAULT 0,
    found_cheaper    BOOLEAN NOT NULL DEFAULT FALSE,
    cache_hits       INTEGER NOT NULL DEFAULT 0,
    live_scrapes     INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compare_events_created
    ON compare_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_compare_events_user
    ON compare_events (user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

COMMIT;
