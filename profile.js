// profile.js — "My details" card in the personal area.
//
// Deliberately independent of alerts.js: the two cards share a page but not a
// code path, so a failure in one leaves the other working.

const PROFILE_API_BASE = window.AUTH_API_BASE || 'http://localhost:3000';

const emailEl = document.getElementById('profileEmail');
const chipsEl = document.getElementById('profileClubs');
const selectEl = document.getElementById('clubSelect');
const addBtn = document.getElementById('clubAddBtn');
const statusEl = document.getElementById('profileStatus');

let profileInstallationId = null;
let catalogClubs = [];
let myClubs = [];

function setStatus(message, tone = 'muted') {
    statusEl.textContent = message || '';
    statusEl.className = `profile-status profile-status--${tone}`;
}

function findClub(name) {
    return catalogClubs.find(club => club.name === name) || null;
}

function buildChip(name) {
    const chip = document.createElement('span');
    chip.className = 'club-chip';

    const club = findClub(name);
    const mark = document.createElement('span');
    mark.className = 'club-chip__mark';

    if (club?.logoUrl) {
        const img = document.createElement('img');
        img.src = club.logoUrl;
        img.alt = '';
        img.className = 'club-chip__logo';
        img.addEventListener('error', () => {
            img.remove();
            mark.textContent = club.initials || name.slice(0, 2);
        });
        mark.append(img);
    } else {
        mark.textContent = club?.initials || name.slice(0, 2);
    }

    const label = document.createElement('span');
    label.className = 'club-chip__label';
    label.textContent = name;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'club-chip__remove';
    remove.setAttribute('aria-label', `הסרת ${name}`);
    remove.textContent = '✕';
    remove.addEventListener('click', () => {
        saveClubs(myClubs.filter(item => item !== name), `${name} הוסר`);
    });

    chip.append(mark, label, remove);
    return chip;
}

function renderChips() {
    if (!myClubs.length) {
        const empty = document.createElement('span');
        empty.className = 'club-chips__empty';
        empty.textContent = 'לא נבחרו מועדונים';
        chipsEl.replaceChildren(empty);
        return;
    }

    chipsEl.replaceChildren(...myClubs.map(buildChip));
}

function renderSelect() {
    const available = catalogClubs.filter(club => !myClubs.includes(club.name));

    selectEl.replaceChildren();

    if (!available.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = catalogClubs.length ? 'כל המועדונים כבר נבחרו' : 'אין מועדונים זמינים';
        selectEl.append(option);
        selectEl.disabled = true;
        addBtn.disabled = true;
        return;
    }

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'בחרו מועדון להוספה';
    selectEl.append(placeholder);

    for (const club of available) {
        const option = document.createElement('option');
        option.value = club.name;
        option.textContent = club.name;
        selectEl.append(option);
    }

    selectEl.disabled = false;
    addBtn.disabled = true;
}

function renderProfile() {
    renderChips();
    renderSelect();
}

/**
 * The server is the source of truth: the UI redraws from its response, so an
 * unknown club silently dropped server-side never lingers on screen.
 */
async function saveClubs(nextClubs, successMessage) {
    setStatus('שומר...', 'muted');
    addBtn.disabled = true;

    try {
        const res = await fetch(
            `${PROFILE_API_BASE}/api/users/${encodeURIComponent(profileInstallationId)}/clubs`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ consumerClubs: nextClubs })
            }
        );

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

        myClubs = data.user?.consumerClubs || [];
        renderProfile();
        setStatus(successMessage || 'הפרטים עודכנו', 'ok');

        if (typeof saveUserProfile === 'function' && data.user) {
            await saveUserProfile(data.user, profileInstallationId).catch(() => {});
        }
    } catch (err) {
        renderProfile();
        setStatus('העדכון נכשל. ודאו שהשרת פועל ונסו שוב', 'error');
        console.warn('[Profile] Club update failed:', err.message);
    }
}

async function loadCatalog() {
    try {
        const res = await fetch(`${PROFILE_API_BASE}/api/clubs`);
        const data = await res.json();
        catalogClubs = Array.isArray(data.clubs) ? data.clubs : [];
    } catch (_) {
        catalogClubs = [];
    }
}

async function loadProfile() {
    const stored = typeof getStoredUserProfile === 'function'
        ? await getStoredUserProfile()
        : null;

    if (stored?.email) emailEl.textContent = stored.email;
    myClubs = Array.isArray(stored?.consumerClubs) ? stored.consumerClubs : [];

    try {
        const res = await fetch(
            `${PROFILE_API_BASE}/api/users/status?installationId=${encodeURIComponent(profileInstallationId)}`
        );
        const data = await res.json();

        if (data.user) {
            emailEl.textContent = data.user.email || '—';
            myClubs = data.user.consumerClubs || [];
        }
    } catch (_) {
        setStatus('לא הצלחנו לרענן את הפרטים מהשרת', 'error');
    }
}

selectEl.addEventListener('change', () => {
    addBtn.disabled = !selectEl.value;
});

addBtn.addEventListener('click', () => {
    const name = selectEl.value;
    if (!name || myClubs.includes(name)) return;
    saveClubs([...myClubs, name], `${name} נוסף`);
});

document.addEventListener('DOMContentLoaded', async () => {
    try {
        profileInstallationId = await getOrCreateInstallationId();
    } catch (_) {
        setStatus('לא הצלחנו לזהות את המשתמש', 'error');
        return;
    }

    await Promise.all([loadCatalog(), loadProfile()]);
    renderProfile();
});
