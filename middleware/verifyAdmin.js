/**
 * Simple admin gate — expects the user's UUID (users.id) in X-User-Id header.
 * Apply to all /api/admin/* routes in Phase 2.
 */
function createVerifyAdmin(pool) {
    return async function verifyAdmin(req, res, next) {
        const userId = req.headers['x-user-id'] || req.body?.userId || req.query?.userId;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required (X-User-Id header)' });
        }

        try {
            const { rows } = await pool.query(
                `SELECT id, email, is_admin
                 FROM users
                 WHERE id = $1 AND is_active = TRUE`,
                [userId]
            );

            if (!rows.length) {
                return res.status(401).json({ error: 'User not found' });
            }

            if (!rows[0].is_admin) {
                return res.status(403).json({ error: 'Admin access required' });
            }

            req.adminUser = rows[0];
            next();
        } catch (err) {
            console.error('[verifyAdmin]', err.message);
            if (err.code === 'ECONNREFUSED') {
                return res.status(503).json({ error: 'PostgreSQL is not running on localhost:5432' });
            }
            if (err.code === '42P01' || err.code === '42703') {
                return res.status(503).json({ error: 'Registration tables/columns missing. Run: npm run migrate' });
            }
            res.status(500).json({ error: err.message || 'Authorization check failed' });
        }
    };
}

module.exports = { createVerifyAdmin };
