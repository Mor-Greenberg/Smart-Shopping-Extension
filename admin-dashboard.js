const COUNTRY_LABELS = { IL: 'Israel 🇮🇱', US: 'USA 🇺🇸' };

const RETAIL_SITES = [
    { key: 'shop.super-pharm.co.il', name: 'Super-Pharm' },
    { key: '365mashbir.co.il', name: 'Mashbir' },
    { key: 'www.shufersal.co.il', name: 'Shufersal' }
];

const pageError = document.getElementById('pageError');

function showError(message) {
    pageError.textContent = message || '';
    pageError.hidden = !message;
}

async function adminFetch(path, options = {}) {
    const profile = await getStoredUserProfile();
    if (!profile?.userId || !profile?.isAdmin) {
        throw new Error('Admin access required. Set is_admin = true for your user, then reopen the extension.');
    }

    const apiBase = (typeof AUTH_API_BASE !== 'undefined' && AUTH_API_BASE)
        || 'http://localhost:3000';
    const method = options.method || 'GET';
    const headers = {
        'Content-Type': 'application/json',
        'X-User-Id': profile.userId,
        ...(options.headers || {})
    };

    let response;
    try {
        if (chrome?.runtime?.sendMessage) {
            response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    type: 'API_REQUEST',
                    payload: {
                        path,
                        method,
                        headers: { 'X-User-Id': profile.userId },
                        body: options.body ?? null
                    }
                }, (result) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (!result) {
                        reject(new Error('השרת לא רץ. הפעילי npm run start:all בתיקיית הפרויקט.'));
                        return;
                    }
                    resolve(result);
                });
            });
        } else {
            const res = await fetch(`${apiBase}${path}`, {
                ...options,
                method,
                headers
            });
            const data = await res.json().catch(() => ({}));
            response = { ok: res.ok, status: res.status, data };
        }
    } catch (err) {
        if (/Failed to fetch|NetworkError|ECONNREFUSED/i.test(String(err.message || ''))) {
            throw new Error('השרת לא רץ. הפעילי npm run start:all בתיקיית הפרויקט.');
        }
        throw err;
    }

    if (!response.ok && path !== '/api/admin/health') {
        throw new Error(response.data?.error || response.error || `HTTP ${response.status}`);
    }
    return response.data;
}

function setActiveTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
        panel.hidden = panel.dataset.panel !== tabId;
    });
}

function barRow(label, count, max, display) {
    const width = max > 0 ? Math.max(8, Math.round((count / max) * 100)) : 8;
    return `
        <div class="bar">
            <div class="bar__meta">
                <strong>${label}</strong>
                <span>${display != null ? display : count}</span>
            </div>
            <div class="bar__track">
                <div class="bar__fill" style="width:${width}%"></div>
            </div>
        </div>`;
}

function formatShekel(amount) {
    return `₪${Number(amount || 0).toLocaleString('en-US')}`;
}

function renderPerformanceMetrics(stats = {}) {
    document.getElementById('kpiSuccessfulSearches').textContent =
        Number(stats.successfulSearches || 0).toLocaleString('en-US');
    document.getElementById('kpiMoneySaved').textContent =
        formatShekel(stats.totalMoneySaved);
    document.getElementById('kpiCacheHits').textContent =
        Number(stats.cacheHits || 0).toLocaleString('en-US');

    const body = document.getElementById('topSaversBody');
    const savers = stats.topSavers || [];
    body.innerHTML = savers.length
        ? savers.map((row, index) => `
        <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(row.email)}</td>
            <td><strong>${formatShekel(row.saved)}</strong></td>
        </tr>`).join('')
        : '<tr><td colspan="3" class="empty">No savings recorded yet</td></tr>';
}

function renderOverview(stats) {
    document.getElementById('kpiTotalUsers').textContent = stats.totalUsers ?? 0;
    document.getElementById('kpiActiveQuestions').textContent = stats.activeQuestions ?? 0;
    renderPerformanceMetrics(stats);

    const countries = stats.usersByCountry || [];
    const countryMax = Math.max(1, ...countries.map((r) => r.count));
    document.getElementById('countryList').innerHTML = countries.length
        ? countries.map((r) => barRow(COUNTRY_LABELS[r.country] || r.country, r.count, countryMax)).join('')
        : '<p class="muted">No country data yet</p>';

    const clubs = stats.topConsumerClubs || [];
    const clubMax = Math.max(1, ...clubs.map((r) => r.count));
    document.getElementById('clubList').innerHTML = clubs.length
        ? clubs.map((r) => barRow(escapeHtml(r.club), r.count, clubMax)).join('')
        : '<p class="muted">No clubs defined yet</p>';

    const answers = stats.questionAnswers || [];
    const totalUsers = stats.totalUsers || 0;
    document.getElementById('answersList').innerHTML = answers.length
        ? answers.map((r) => barRow(
            r.question_text,
            r.answered_count || 0,
            Math.max(totalUsers, 1),
            `${r.answered_count || 0}/${totalUsers}`
        )).join('')
        : '<p class="muted">No questions yet</p>';
}

function statusBadge(healthy) {
    return healthy
        ? '<span class="badge badge--ok">Healthy</span>'
        : '<span class="badge badge--bad">Broken</span>';
}

function latestLogForSite(logs, siteKey) {
    return (logs || []).find((row) => row.site_key === siteKey) || null;
}

function renderHealthTable(health, logs) {
    const scraperOk = Boolean(health?.scraper?.ok);
    const fallbackMs = health?.scraper?.latencyMs;

    document.getElementById('healthTableBody').innerHTML = RETAIL_SITES.map((site) => {
        const log = latestLogForSite(logs, site.key);
        const healthy = log ? log.status !== 'broken' : scraperOk;
        const latency = log?.latency_ms ?? fallbackMs;
        const lastChecked = log?.created_at ? new Date(log.created_at).toLocaleString() : '—';
        const error = healthy ? '—' : (log?.message || health?.scraper?.message || 'Scraper unreachable');

        return `
            <tr>
                <td><strong>${site.name}</strong></td>
                <td>${statusBadge(healthy)}</td>
                <td>${latency != null ? `${latency} ms` : '—'}</td>
                <td>${lastChecked}</td>
                <td>${error}</td>
            </tr>`;
    }).join('');
}

function clubInitials(label) {
    const parts = String(label || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'CL';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderClubs(clubs) {
    const grid = document.getElementById('clubGrid');
    if (!clubs.length) {
        grid.innerHTML = '<p class="muted">No clubs yet.</p>';
        return;
    }

    grid.innerHTML = clubs.map((club) => {
        const name = club.name || club.label || '';
        const logoUrl = club.logoUrl || club.image_url || '';
        const initials = club.initials || clubInitials(name);
        const logo = logoUrl
            ? `<span class="club-admin-card__logo"><img src="${escapeHtml(logoUrl)}" alt=""></span>`
            : `<span class="club-admin-card__logo">${escapeHtml(initials)}</span>`;
        return `
            <article class="club-admin-card">
                <button type="button" class="icon-x" data-id="${escapeHtml(club.id)}" aria-label="Delete club">✕</button>
                ${logo}
                <span class="club-admin-card__name">${escapeHtml(name)}</span>
            </article>`;
    }).join('');
}

function renderQuestions(questions) {
    const list = document.getElementById('questionList');
    if (!questions.length) {
        list.innerHTML = '<li class="empty">No questions yet.</li>';
        return;
    }

    list.innerHTML = questions.map((q) => {
        const type = q.question_type === 'multiple_choice' ? 'Multiple Choice' : 'Open Text';
        const options = Array.isArray(q.options) ? q.options : [];
        const optionLine = options.length ? options.join(', ') : '—';
        return `
        <li class="question-item">
            <p class="question-item__text ${q.is_active ? '' : 'is-off'}">${escapeHtml(q.question_text)}</p>
            <div class="question-item__meta">
                <strong>${type}</strong>
                ${escapeHtml(optionLine)}
            </div>
            <button type="button" data-action="required" data-id="${q.id}" data-value="${q.is_required}" class="switch-btn">
                Required <span class="switch ${q.is_required ? 'is-on' : ''}"></span>
            </button>
            <button type="button" data-action="active" data-id="${q.id}" data-value="${q.is_active}" class="switch-btn">
                Active <span class="switch ${q.is_active ? 'is-on' : ''}"></span>
            </button>
            <button type="button" data-action="delete" data-id="${q.id}" class="icon-x" aria-label="Delete question">✕</button>
        </li>`;
    }).join('');
}

let draftOptions = [];

function renderDraftOptions() {
    const list = document.getElementById('optionsList');
    list.innerHTML = draftOptions.map((opt, index) => `
        <li class="option-chip">
            ${escapeHtml(opt)}
            <button type="button" data-remove-option="${index}" aria-label="Remove option">✕</button>
        </li>`).join('');
}

function syncOptionsPanel() {
    const isMultiple = document.getElementById('questionType').value === 'multiple_choice';
    document.getElementById('optionsPanel').hidden = !isMultiple;
}

async function loadOverview() {
    const stats = await adminFetch('/api/admin/stats');
    renderOverview(stats);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadHealthLogs() {
    const logsRes = await adminFetch('/api/admin/health-logs');
    renderHealthTable({}, logsRes.logs || []);
    return logsRes;
}

async function loadHealth() {
    const logsRes = await loadHealthLogs();
    try {
        const health = await Promise.race([
            adminFetch('/api/admin/health'),
            sleep(2500).then(() => null)
        ]);
        if (health) renderHealthTable(health, logsRes.logs || []);
    } catch (_) { /* logs already rendered */ }
    return logsRes;
}

function setHealthCheckRunning(running) {
    const banner = document.getElementById('healthRunningBanner');
    const overlay = document.getElementById('healthCheckOverlay');
    const btn = document.getElementById('runHealthBtn');
    const show = Boolean(running);
    if (banner) banner.hidden = !show;
    if (overlay) overlay.hidden = !show;
    if (btn) {
        btn.disabled = show;
        btn.textContent = show ? 'Checking selectors…' : 'Run Health Check Now';
    }
}

function resultsToLogs(results) {
    return (results || []).map((row) => ({
        site_key: row.siteKey,
        status: row.status,
        message: row.message,
        latency_ms: row.latencyMs,
        created_at: new Date().toISOString()
    }));
}

async function pollUntilHealthIdle() {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
        await sleep(3000);
        const logsRes = await loadHealthLogs();
        if (!logsRes.running) return logsRes;
    }
    return loadHealthLogs();
}

async function runHealthCheck() {
    showError('');
    setHealthCheckRunning(true);
    try {
        const result = await adminFetch('/api/admin/health-check', { method: 'POST' });
        if (result.results) {
            renderHealthTable({}, resultsToLogs(result.results));
        }
        if (result.skipped && /already running/i.test(result.reason || result.error || '')) {
            await pollUntilHealthIdle();
        }
    } catch (err) {
        if (/already running/i.test(err.message)) {
            await pollUntilHealthIdle();
        } else {
            showError(err.message);
        }
    } finally {
        setHealthCheckRunning(false);
    }
    try {
        await loadHealthLogs();
    } catch (_) { /* table already shows POST results */ }
}

async function loadQuestions() {
    const data = await adminFetch('/api/admin/questions');
    renderQuestions(data.questions || []);
}

async function loadClubs() {
    const data = await adminFetch('/api/admin/clubs');
    renderClubs(data.clubs || []);
}

// ── Club ↔ site mapping ──

function clubToggle(club, checked) {
    const name = club.name || club.label || '';
    const logoUrl = club.logoUrl || club.image_url || '';
    const logo = logoUrl
        ? `<img src="${escapeHtml(logoUrl)}" alt="">`
        : escapeHtml(club.initials || clubInitials(name));

    return `
        <label class="mapping-club ${checked ? 'is-on' : ''}">
            <input type="checkbox" value="${escapeHtml(club.id)}" ${checked ? 'checked' : ''}>
            <span class="mapping-club__logo">${logo}</span>
            <span class="mapping-club__name">${escapeHtml(name)}</span>
        </label>`;
}

function renderMapping({ sites = [], clubs = [], siteClubs = {} }) {
    const grid = document.getElementById('mappingGrid');

    if (!sites.length) {
        grid.innerHTML = '<p class="muted">No retail sites are enabled.</p>';
        return;
    }

    if (!clubs.length) {
        grid.innerHTML = '<p class="muted">Add consumer clubs first, in Registration Page Management.</p>';
        return;
    }

    grid.innerHTML = sites.map((site) => {
        const selected = new Set((siteClubs[site.key] || []).map((c) => String(c.id)));
        const toggles = clubs.map((club) => clubToggle(club, selected.has(String(club.id)))).join('');

        return `
            <article class="card mapping-card" data-site="${escapeHtml(site.key)}">
                <div class="mapping-card__head">
                    <h3>${escapeHtml(site.name)}</h3>
                    <span class="mapping-card__key">${escapeHtml(site.key)}</span>
                </div>
                <div class="mapping-card__clubs">${toggles}</div>
                <div class="mapping-card__foot">
                    <span class="mapping-card__status" role="status"></span>
                    <button type="button" class="btn-primary" data-save-site="${escapeHtml(site.key)}">Save</button>
                </div>
            </article>`;
    }).join('');
}

async function loadMapping() {
    const data = await adminFetch('/api/admin/site-clubs');
    renderMapping(data);
}

async function saveMapping(siteKey, card) {
    const status = card.querySelector('.mapping-card__status');
    const button = card.querySelector('[data-save-site]');
    const clubIds = [...card.querySelectorAll('input[type="checkbox"]:checked')]
        .map((input) => Number(input.value));

    button.disabled = true;
    status.textContent = 'Saving…';
    status.className = 'mapping-card__status';

    try {
        await adminFetch(`/api/admin/site-clubs/${encodeURIComponent(siteKey)}`, {
            method: 'PUT',
            body: JSON.stringify({ clubIds })
        });
        status.textContent = `Saved · ${clubIds.length} club${clubIds.length === 1 ? '' : 's'}`;
        status.className = 'mapping-card__status is-ok';
    } catch (err) {
        status.textContent = err.message;
        status.className = 'mapping-card__status is-error';
    } finally {
        button.disabled = false;
    }
}

document.getElementById('mappingGrid').addEventListener('click', (event) => {
    const label = event.target.closest('.mapping-club');
    if (label) {
        // The class drives the selected styling, so keep it in sync with the box.
        setTimeout(() => {
            label.classList.toggle('is-on', label.querySelector('input').checked);
        }, 0);
    }

    const saveBtn = event.target.closest('[data-save-site]');
    if (!saveBtn) return;
    saveMapping(saveBtn.dataset.saveSite, saveBtn.closest('.mapping-card'));
});

document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
});

document.getElementById('runHealthBtn').addEventListener('click', (event) => {
    event.preventDefault();
    const btn = document.getElementById('runHealthBtn');
    if (btn.disabled) return;
    runHealthCheck();
});

document.getElementById('questionType').addEventListener('change', syncOptionsPanel);

document.getElementById('addOptionBtn').addEventListener('click', () => {
    const input = document.getElementById('optionInput');
    const value = input.value.trim();
    if (!value) return;
    draftOptions.push(value);
    input.value = '';
    renderDraftOptions();
});

document.getElementById('optionsList').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-remove-option]');
    if (!btn) return;
    draftOptions.splice(Number(btn.dataset.removeOption), 1);
    renderDraftOptions();
});

document.getElementById('clubForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    showError('');
    const submitBtn = event.target.querySelector('button[type="submit"]');
    const name = document.getElementById('clubName').value.trim();
    const logoUrl = document.getElementById('clubImageUrl').value.trim();
    if (!name) return;

    submitBtn.disabled = true;
    try {
        const result = await adminFetch('/api/admin/clubs', {
            method: 'POST',
            body: JSON.stringify({ name, logoUrl })
        });
        if (!result.ok) throw new Error(result.error || 'Failed to add club');
        document.getElementById('clubName').value = '';
        document.getElementById('clubImageUrl').value = '';
        await loadClubs();
        await loadMapping().catch(() => {});
    } catch (err) {
        showError(err.message);
    } finally {
        submitBtn.disabled = false;
    }
});

document.getElementById('clubGrid').addEventListener('click', async (event) => {
    const btn = event.target.closest('.icon-x[data-id]');
    if (!btn) return;

    event.preventDefault();
    event.stopPropagation();

    const clubId = btn.getAttribute('data-id');
    if (!clubId) {
        alert('Cannot delete club: missing id');
        return;
    }

    showError('');
    btn.disabled = true;

    try {
        const profile = await getStoredUserProfile();
        if (!profile?.userId || !profile?.isAdmin) {
            throw new Error('Admin access required');
        }

        console.log('Sending DELETE request for club:', clubId);
        const data = await adminFetch(`/api/admin/clubs/${clubId}`, { method: 'DELETE' });
        if (!data.ok && data.error) {
            throw new Error(data.error);
        }

        const card = btn.closest('.club-admin-card');
        if (card) card.remove();
        const grid = document.getElementById('clubGrid');
        if (!grid.querySelector('.club-admin-card')) {
            grid.innerHTML = '<p class="muted">No clubs yet.</p>';
        }
        await loadMapping().catch(() => {});
    } catch (err) {
        alert(err.message || 'Failed to delete club');
        showError(err.message);
        btn.disabled = false;
    }
});

document.getElementById('questionForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    showError('');
    const submitBtn = event.target.querySelector('button[type="submit"]');
    const questionType = document.getElementById('questionType').value;
    submitBtn.disabled = true;
    try {
        const result = await adminFetch('/api/admin/questions', {
            method: 'POST',
            body: JSON.stringify({
                questionText: document.getElementById('questionText').value.trim(),
                isRequired: document.getElementById('questionRequired').checked,
                isActive: true,
                questionType,
                options: questionType === 'multiple_choice' ? draftOptions : []
            })
        });
        if (!result.ok) throw new Error(result.error || 'Failed to add question');
        document.getElementById('questionText').value = '';
        document.getElementById('questionRequired').checked = false;
        document.getElementById('questionType').value = 'open_text';
        draftOptions = [];
        renderDraftOptions();
        syncOptionsPanel();
        await Promise.all([loadQuestions(), loadOverview()]);
    } catch (err) {
        showError(err.message);
    } finally {
        submitBtn.disabled = false;
    }
});

document.getElementById('questionList').addEventListener('click', async (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;

    const id = btn.dataset.id;
    const action = btn.dataset.action;
    showError('');
    btn.disabled = true;

    try {
        let result;
        if (action === 'delete') {
            result = await adminFetch(`/api/admin/questions/${id}`, { method: 'DELETE' });
        } else if (action === 'required') {
            result = await adminFetch(`/api/admin/questions/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ isRequired: btn.dataset.value !== 'true' })
            });
        } else if (action === 'active') {
            result = await adminFetch(`/api/admin/questions/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ isActive: btn.dataset.value !== 'true' })
            });
        }
        if (!result?.ok) throw new Error(result?.error || 'Update failed');
        await Promise.all([loadQuestions(), loadOverview()]);
    } catch (err) {
        showError(err.message);
        btn.disabled = false;
    }
});

document.getElementById('backToPopupBtn')?.addEventListener('click', () => {
    location.replace(chrome.runtime.getURL('popup.html'));
});

document.addEventListener('DOMContentLoaded', async () => {
    setActiveTab('overview');
    syncOptionsPanel();
    try {
        const profile = await getStoredUserProfile();
        if (!profile?.isAdmin) {
            location.replace(chrome.runtime.getURL('popup.html'));
            return;
        }
        document.getElementById('adminEmail').textContent = profile.email || '';
        setHealthCheckRunning(false);
        await Promise.all([
            loadOverview(),
            loadQuestions(),
            loadClubs(),
            loadMapping(),
            loadHealthLogs()
        ]);
    } catch (err) {
        showError(err.message);
    }
});
