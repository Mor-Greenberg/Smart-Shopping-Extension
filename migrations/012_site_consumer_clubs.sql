-- Which consumer clubs are honoured at which retail site.
--
-- A join table rather than a JSONB column on a sites table: retail sites live
-- in config.js, not in the DB, and the FK to consumer_clubs means deleting a
-- club from the admin panel cleans up its mappings automatically.

BEGIN;

CREATE TABLE IF NOT EXISTS site_consumer_clubs (
    site_key   VARCHAR(128) NOT NULL,
    club_id    INTEGER NOT NULL REFERENCES consumer_clubs(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (site_key, club_id)
);

CREATE INDEX IF NOT EXISTS idx_site_consumer_clubs_site
    ON site_consumer_clubs (site_key);

COMMIT;
