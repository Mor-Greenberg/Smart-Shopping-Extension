function initialsFrom(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'CL';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function toClubDto(row) {
    if (!row) return null;
    return {
        id: row.id,
        name: row.name,
        logoUrl: row.logo_url || null,
        initials: initialsFrom(row.name)
    };
}

async function listClubs(pool) {
    const { rows } = await pool.query(
        `SELECT id, name, logo_url
         FROM consumer_clubs
         ORDER BY name ASC`
    );
    return rows.map(toClubDto);
}

async function createClub(pool, { name, logoUrl }) {
    const clubName = String(name || '').trim();
    if (!clubName) {
        const err = new Error('Club name is required');
        err.status = 400;
        throw err;
    }

    const url = logoUrl ? String(logoUrl).trim() : null;

    try {
        const { rows } = await pool.query(
            `INSERT INTO consumer_clubs (name, logo_url)
             VALUES ($1, $2)
             RETURNING id, name, logo_url`,
            [clubName, url || null]
        );
        return toClubDto(rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            const dup = new Error('A club with this name already exists');
            dup.status = 409;
            throw dup;
        }
        throw err;
    }
}

async function deleteClub(pool, id) {
    const clubId = Number(id);
    if (!Number.isInteger(clubId)) {
        const err = new Error('Invalid club id');
        err.status = 400;
        throw err;
    }

    const { rows } = await pool.query(
        `DELETE FROM consumer_clubs WHERE id = $1 RETURNING id`,
        [clubId]
    );
    if (!rows.length) {
        const err = new Error('Club not found');
        err.status = 404;
        throw err;
    }
    return { id: rows[0].id };
}

module.exports = { listClubs, createClub, deleteClub };
