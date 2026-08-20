-- ConsumerClubs: id, name, logoUrl (logo_url)

BEGIN;

CREATE TABLE IF NOT EXISTS consumer_clubs (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(255) NOT NULL,
    logo_url   TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_consumer_clubs_name_lower
    ON consumer_clubs (LOWER(name));

INSERT INTO consumer_clubs (name, logo_url)
SELECT src.label, src.image_url
FROM consumer_club_catalog src
WHERE NOT EXISTS (
    SELECT 1 FROM consumer_clubs c WHERE LOWER(c.name) = LOWER(src.label)
);

COMMIT;
