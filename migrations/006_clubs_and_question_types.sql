-- Registration catalog: club cards + question types

BEGIN;

ALTER TABLE dynamic_questions
    ADD COLUMN IF NOT EXISTS question_type VARCHAR(32) NOT NULL DEFAULT 'open_text',
    ADD COLUMN IF NOT EXISTS options JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS consumer_club_catalog (
    id         TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    image_url  TEXT,
    initials   TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO consumer_club_catalog (id, label, initials)
VALUES
    ('hever', 'Hever', 'HV'),
    ('pais-plus', 'Pais Plus', 'PP'),
    ('behatzdaa', 'Behatzdaa', 'BH'),
    ('byahad-bishvilcha', 'Byahad Bishvilcha', 'BB'),
    ('hitechzone', 'Hitechzone', 'HZ'),
    ('cibus', 'Cibus', 'CB')
ON CONFLICT (id) DO NOTHING;

COMMIT;
