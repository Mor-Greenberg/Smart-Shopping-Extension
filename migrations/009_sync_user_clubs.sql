-- Sync users.consumer_clubs with the consumer_clubs table.
--
-- Early builds stored hardcoded English slugs ('hever', 'cibus', ...) that no
-- longer correspond to any managed club, which made the admin analytics show
-- clubs that do not exist in the UI. This maps the known legacy slugs onto the
-- club they became and drops every value that no club matches, so the clubs
-- table is the only source of truth.

BEGIN;

WITH alias(legacy, canonical) AS (
    VALUES
        ('hever',             'חבר'),
        ('pais-plus',         'פיס פלוס'),
        ('behatzdaa',         'בהצדעה'),
        ('byahad-bishvilcha', 'ביחד בשבילך'),
        ('hitechzone',        'הייטקזון'),
        ('cibus',             'סיבוס')
),
normalized AS (
    SELECT
        u.id AS user_id,
        COALESCE(
            jsonb_agg(DISTINCT c.name) FILTER (WHERE c.name IS NOT NULL),
            '[]'::jsonb
        ) AS clubs
    FROM users u
    LEFT JOIN LATERAL jsonb_array_elements_text(
        COALESCE(u.consumer_clubs, '[]'::jsonb)
    ) AS sel(val) ON TRUE
    LEFT JOIN alias a
        ON LOWER(TRIM(sel.val)) = LOWER(a.legacy)
    LEFT JOIN consumer_clubs c
        ON LOWER(c.name) = LOWER(COALESCE(a.canonical, TRIM(sel.val)))
    GROUP BY u.id
)
UPDATE users u
SET consumer_clubs = n.clubs
FROM normalized n
WHERE u.id = n.user_id
  AND u.consumer_clubs IS DISTINCT FROM n.clubs;

COMMIT;
