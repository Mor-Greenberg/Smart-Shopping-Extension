function normalizeQuestionType(value) {
    return value === 'multiple_choice' ? 'multiple_choice' : 'open_text';
}

function normalizeOptions(value, questionType) {
    if (questionType !== 'multiple_choice') return [];
    if (!Array.isArray(value)) return [];
    return value.map(String).map((s) => s.trim()).filter(Boolean);
}

async function getActiveQuestions(pool) {
    const { rows } = await pool.query(
        `SELECT id, question_text, is_required, is_active, question_type, options
         FROM dynamic_questions
         WHERE is_active = TRUE
         ORDER BY id ASC`
    );
    return rows;
}

async function listAllQuestions(pool) {
    const { rows } = await pool.query(
        `SELECT id, question_text, is_required, is_active, question_type, options, created_at, updated_at
         FROM dynamic_questions
         ORDER BY id ASC`
    );
    return rows;
}

async function createQuestion(pool, {
    questionText,
    isRequired = false,
    isActive = true,
    questionType = 'open_text',
    options = []
}) {
    const text = String(questionText || '').trim();
    if (!text) {
        const err = new Error('questionText is required');
        err.status = 400;
        throw err;
    }

    const type = normalizeQuestionType(questionType);
    const opts = normalizeOptions(options, type);
    if (type === 'multiple_choice' && opts.length < 2) {
        const err = new Error('Multiple choice questions need at least 2 options');
        err.status = 400;
        throw err;
    }

    const { rows } = await pool.query(
        `INSERT INTO dynamic_questions (question_text, is_required, is_active, question_type, options)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING id, question_text, is_required, is_active, question_type, options, created_at, updated_at`,
        [text, Boolean(isRequired), isActive !== false, type, JSON.stringify(opts)]
    );
    return rows[0];
}

function parseQuestionId(id) {
    const questionId = Number(id);
    if (!Number.isInteger(questionId) || questionId <= 0) {
        const err = new Error('Invalid question id');
        err.status = 400;
        throw err;
    }
    return questionId;
}

async function updateQuestion(pool, id, { questionText, isRequired, isActive, questionType, options }) {
    const questionId = parseQuestionId(id);
    const { rows: existing } = await pool.query(
        `SELECT id FROM dynamic_questions WHERE id = $1`,
        [questionId]
    );
    if (!existing.length) {
        const err = new Error('Question not found');
        err.status = 404;
        throw err;
    }

    const type = questionType != null ? normalizeQuestionType(questionType) : null;
    const opts = options != null ? normalizeOptions(options, type || 'multiple_choice') : null;

    const { rows } = await pool.query(
        `UPDATE dynamic_questions SET
            question_text = COALESCE($2, question_text),
            is_required   = COALESCE($3, is_required),
            is_active     = COALESCE($4, is_active),
            question_type = COALESCE($5, question_type),
            options       = COALESCE($6::jsonb, options),
            updated_at    = NOW()
         WHERE id = $1
         RETURNING id, question_text, is_required, is_active, question_type, options, created_at, updated_at`,
        [
            questionId,
            questionText != null ? String(questionText).trim() : null,
            typeof isRequired === 'boolean' ? isRequired : null,
            typeof isActive === 'boolean' ? isActive : null,
            type,
            opts != null ? JSON.stringify(opts) : null
        ]
    );
    return rows[0];
}

async function disableQuestion(pool, id) {
    return updateQuestion(pool, id, { isActive: false });
}

async function deleteQuestion(pool, id) {
    const questionId = parseQuestionId(id);
    const { rows } = await pool.query(
        `DELETE FROM dynamic_questions
         WHERE id = $1
         RETURNING id`,
        [questionId]
    );
    if (!rows.length) {
        const err = new Error('Question not found');
        err.status = 404;
        throw err;
    }
    return rows[0];
}

module.exports = {
    getActiveQuestions,
    listAllQuestions,
    createQuestion,
    updateQuestion,
    disableQuestion,
    deleteQuestion
};
