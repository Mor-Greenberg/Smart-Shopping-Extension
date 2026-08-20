-- Phase 1: Registration fields on users + dynamic_questions table

BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email            VARCHAR(255),
    ADD COLUMN IF NOT EXISTS consumer_clubs   JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS country          VARCHAR(128),
    ADD COLUMN IF NOT EXISTS dynamic_answers  JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS is_admin         BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS registered_at    TIMESTAMPTZ;

-- Email required for newly registered users; existing anonymous rows stay NULL until register.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
    ON users (LOWER(email))
    WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_country ON users (country);
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users (is_admin) WHERE is_admin = TRUE;

CREATE TABLE IF NOT EXISTS dynamic_questions (
    id            SERIAL PRIMARY KEY,
    question_text TEXT NOT NULL,
    is_required   BOOLEAN NOT NULL DEFAULT FALSE,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dynamic_questions_active
    ON dynamic_questions (is_active, id)
    WHERE is_active = TRUE;

-- Optional starter questions (safe to re-run: only inserts when table is empty)
INSERT INTO dynamic_questions (question_text, is_required, is_active)
SELECT q.question_text, q.is_required, q.is_active
FROM (VALUES
    ('How did you hear about Smart Shopping?', FALSE, TRUE),
    ('Which product categories do you shop for most?', FALSE, TRUE)
) AS q(question_text, is_required, is_active)
WHERE NOT EXISTS (SELECT 1 FROM dynamic_questions LIMIT 1);

COMMIT;
