-- Phase 2: health logs for admin analytics (Phase 3 cron writes rows)

BEGIN;

CREATE TABLE IF NOT EXISTS health_logs (
    id          SERIAL PRIMARY KEY,
    check_type  VARCHAR(64) NOT NULL,
    site_key    VARCHAR(128),
    status      VARCHAR(32) NOT NULL,
    message     TEXT,
    latency_ms  INTEGER,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_logs_created
    ON health_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_health_logs_status
    ON health_logs (status, created_at DESC);

COMMIT;
