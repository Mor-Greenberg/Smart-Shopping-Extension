function attachAdminCatalogRoutes(adminRouter, pool, { log, formatDbError, listClubs, createClub, deleteClub, listAllQuestions, createQuestion, updateQuestion, deleteQuestion }) {
    adminRouter.get('/questions', async (_req, res) => {
        try {
            const questions = await listAllQuestions(pool);
            res.json({ questions });
        } catch (err) {
            log('ERROR', 'Admin list questions failed', { error: formatDbError(err), code: err.code });
            res.status(503).json({ error: formatDbError(err) });
        }
    });

    adminRouter.post('/questions', async (req, res) => {
        try {
            const question = await createQuestion(pool, {
                questionText: req.body.questionText,
                isRequired: req.body.isRequired,
                isActive: req.body.isActive,
                questionType: req.body.questionType,
                options: req.body.options
            });
            res.status(201).json({ ok: true, question });
        } catch (err) {
            log('ERROR', 'Admin create question failed', { error: formatDbError(err), code: err.code });
            res.status(err.status || 503).json({ error: formatDbError(err) });
        }
    });

    adminRouter.put('/questions/:id', async (req, res) => {
        try {
            const question = await updateQuestion(pool, Number(req.params.id), {
                questionText: req.body.questionText,
                isRequired: req.body.isRequired,
                isActive: req.body.isActive,
                questionType: req.body.questionType,
                options: req.body.options
            });
            res.json({ ok: true, question });
        } catch (err) {
            log('ERROR', 'Admin update question failed', { error: formatDbError(err), code: err.code });
            res.status(err.status || 503).json({ error: formatDbError(err) });
        }
    });

    adminRouter.delete('/questions/:id', async (req, res) => {
        try {
            await deleteQuestion(pool, Number(req.params.id));
            res.json({ ok: true });
        } catch (err) {
            log('ERROR', 'Admin delete question failed', { error: formatDbError(err), code: err.code });
            res.status(err.status || 503).json({ error: formatDbError(err) });
        }
    });

    adminRouter.get('/clubs', async (_req, res) => {
        try {
            const clubs = await listClubs(pool);
            res.json({ clubs });
        } catch (err) {
            log('ERROR', 'Admin list clubs failed', { error: formatDbError(err), code: err.code });
            res.status(503).json({ error: formatDbError(err) });
        }
    });

    adminRouter.post('/clubs', async (req, res) => {
        try {
            const club = await createClub(pool, {
                name: req.body.name || req.body.label,
                logoUrl: req.body.logoUrl || req.body.imageUrl
            });
            res.status(201).json({ ok: true, club });
        } catch (err) {
            log('ERROR', 'Admin create club failed', { error: formatDbError(err), code: err.code });
            res.status(err.status || 503).json({ error: formatDbError(err) });
        }
    });

    adminRouter.delete('/clubs/:id', async (req, res) => {
        console.log(`[DELETE] Request received for club ID: ${req.params.id}`);
        try {
            await deleteClub(pool, req.params.id);
            res.status(200).json({ ok: true });
        } catch (err) {
            log('ERROR', 'Admin delete club failed', { error: formatDbError(err), code: err.code });
            res.status(err.status || 503).json({ error: formatDbError(err) });
        }
    });
}

module.exports = { attachAdminCatalogRoutes };
