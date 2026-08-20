const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
    return UUID_RE.test(String(value || ''));
}

function normalizeConsumerClubs(value) {
    if (!Array.isArray(value)) return [];
    return value.map(String).map(s => s.trim()).filter(Boolean);
}

/**
 * consumer_clubs is the single source of truth: anything the client sends that
 * does not match a row there is dropped, and matches are stored under the
 * canonical DB name so analytics can group on it.
 */
async function resolveConsumerClubs(pool, value) {
    const selected = normalizeConsumerClubs(value);
    if (!selected.length) return [];

    const { rows } = await pool.query(
        `SELECT name FROM consumer_clubs WHERE LOWER(name) = ANY($1::text[])`,
        [selected.map(s => s.toLowerCase())]
    );

    return rows.map(row => row.name);
}

function normalizeDynamicAnswers(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value;
}

async function getRegistrationStatus(pool, installationId) {
    if (!isUuid(installationId)) {
        return { registered: false, user: null };
    }

    const { rows } = await pool.query(
        `SELECT id, email, country, consumer_clubs, dynamic_answers, is_admin, registered_at
         FROM users
         WHERE installation_id = $1::uuid`,
        [installationId]
    );

    if (!rows.length) {
        return { registered: false, user: null };
    }

    const user = rows[0];
    return {
        registered: Boolean(user.email && user.registered_at),
        user: {
            id: user.id,
            email: user.email,
            country: user.country,
            consumerClubs: user.consumer_clubs || [],
            dynamicAnswers: user.dynamic_answers || {},
            isAdmin: user.is_admin,
            registeredAt: user.registered_at
        }
    };
}

async function registerUser(pool, payload) {
    const {
        installationId,
        email,
        consumerClubs = [],
        country = null,
        dynamicAnswers = {},
        extensionVersion = null,
        locale = 'he-IL',
        platform = null
    } = payload;

    if (!installationId) {
        const err = new Error('installationId is required');
        err.status = 400;
        throw err;
    }

    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(normalizedEmail)) {
        const err = new Error('Valid email is required');
        err.status = 400;
        throw err;
    }

    const clubs = await resolveConsumerClubs(pool, consumerClubs);
    const answers = normalizeDynamicAnswers(dynamicAnswers);

    const { rows: requiredQuestions } = await pool.query(
        `SELECT id, question_text FROM dynamic_questions
         WHERE is_active = TRUE AND is_required = TRUE`
    );

    for (const q of requiredQuestions) {
        const key = String(q.id);
        const answer = answers[key] ?? answers[q.question_text];
        if (answer == null || String(answer).trim() === '') {
            const err = new Error(`Required question not answered: ${q.question_text}`);
            err.status = 400;
            throw err;
        }
    }

    const { rows } = await pool.query(
        `INSERT INTO users (
            installation_id, email, consumer_clubs, country, dynamic_answers,
            extension_version, locale, platform, registered_at, last_seen_at
         )
         VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (installation_id) DO UPDATE SET
            email             = EXCLUDED.email,
            consumer_clubs    = EXCLUDED.consumer_clubs,
            country           = EXCLUDED.country,
            dynamic_answers   = EXCLUDED.dynamic_answers,
            extension_version = COALESCE(EXCLUDED.extension_version, users.extension_version),
            locale            = COALESCE(EXCLUDED.locale, users.locale),
            platform          = COALESCE(EXCLUDED.platform, users.platform),
            registered_at     = COALESCE(users.registered_at, NOW()),
            last_seen_at      = NOW()
         RETURNING id, email, country, consumer_clubs, dynamic_answers, is_admin, registered_at`,
        [
            installationId,
            normalizedEmail,
            JSON.stringify(clubs),
            country ? String(country).trim() : null,
            JSON.stringify(answers),
            extensionVersion,
            locale,
            platform
        ]
    );

    const user = rows[0];
    return {
        id: user.id,
        email: user.email,
        country: user.country,
        consumerClubs: user.consumer_clubs || [],
        dynamicAnswers: user.dynamic_answers || {},
        isAdmin: user.is_admin,
        registeredAt: user.registered_at
    };
}

/**
 * Personal area club editing. Touches only users.consumer_clubs and reuses
 * resolveConsumerClubs, so anything the client sends that is not an active club
 * is dropped and the rest is stored under the canonical DB name — the same rule
 * registration follows, which keeps admin analytics groupable.
 */
async function updateConsumerClubs(pool, installationId, clubs) {
    if (!isUuid(installationId)) {
        const err = new Error('A valid installationId is required');
        err.status = 400;
        throw err;
    }

    if (!Array.isArray(clubs)) {
        const err = new Error('consumerClubs must be an array');
        err.status = 400;
        throw err;
    }

    const resolved = [...new Set(await resolveConsumerClubs(pool, clubs))];

    const { rows } = await pool.query(
        `UPDATE users
         SET consumer_clubs = $2::jsonb
         WHERE installation_id = $1::uuid
           AND email IS NOT NULL
         RETURNING id, email, country, consumer_clubs, dynamic_answers, is_admin, registered_at`,
        [installationId, JSON.stringify(resolved)]
    );

    if (!rows.length) {
        const err = new Error('Registered user not found');
        err.status = 404;
        throw err;
    }

    const user = rows[0];
    return {
        id: user.id,
        email: user.email,
        country: user.country,
        consumerClubs: user.consumer_clubs || [],
        dynamicAnswers: user.dynamic_answers || {},
        isAdmin: user.is_admin,
        registeredAt: user.registered_at
    };
}

module.exports = {
    registerUser,
    getRegistrationStatus,
    updateConsumerClubs
};
