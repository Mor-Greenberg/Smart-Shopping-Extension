const API_BASE = 'http://localhost:3000';
const REGISTER_PAGE = 'register.html';

function getStorageLocal() {
    try {
        return globalThis.chrome?.storage?.local || null;
    } catch (_) {
        return null;
    }
}

function ensureInstallationId() {
    const storage = getStorageLocal();
    if (!storage) return;

    storage.get(['installation_id', 'user_id'], (result) => {
        if (result?.installation_id || result?.user_id) return;

        const newId = crypto.randomUUID();
        storage.set({ installation_id: newId }, () => {
            console.log('[Background] Created installation_id:', newId);
        });
    });
}

function isRegisteredLocally(callback) {
    const storage = getStorageLocal();
    if (!storage) {
        callback(false);
        return;
    }

    storage.get(['userProfile'], (result) => {
        const profile = result?.userProfile;
        callback(Boolean(profile?.registrationComplete && profile?.userId && profile?.email));
    });
}

function openRegistrationTab() {
    const url = chrome.runtime.getURL(REGISTER_PAGE);
    chrome.tabs.query({ url }, (tabs) => {
        if (chrome.runtime.lastError) {
            chrome.tabs.create({ url });
            return;
        }
        if (tabs && tabs.length > 0) {
            chrome.tabs.update(tabs[0].id, { active: true });
            return;
        }
        chrome.tabs.create({ url });
    });
}

const ALERT_ALARM = 'price-drop-poll';
const ALERT_POLL_MINUTES = 10;
const NOTIFIED_IDS_KEY = 'notifiedAlertIds';
const NOTIFIED_IDS_LIMIT = 200;
const TRACKED_CACHE_KEY = 'trackedItemsCache';
const ALERTS_PAGE = 'alerts.html';

let notificationIconUrl = null;

/**
 * Notifications require an iconUrl and the extension ships no image assets, so
 * the icon is drawn once at runtime and cached as a data URL.
 */
async function getNotificationIcon() {
    if (notificationIconUrl !== null) return notificationIconUrl;

    try {
        const size = 128;
        const canvas = new OffscreenCanvas(size, size);
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#450693';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 80px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('₪', size / 2, size / 2 + 6);

        const blob = await canvas.convertToBlob({ type: 'image/png' });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);

        notificationIconUrl = `data:image/png;base64,${btoa(binary)}`;
    } catch (_) {
        notificationIconUrl = '';
    }

    return notificationIconUrl;
}

function setAlertBadge(count) {
    if (!chrome.action?.setBadgeText) return;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor?.({ color: '#FF3F7F' });
}

function getNotifiedIds() {
    const storage = getStorageLocal();
    if (!storage) return Promise.resolve([]);

    return new Promise((resolve) => {
        storage.get([NOTIFIED_IDS_KEY], (result) => {
            resolve(Array.isArray(result?.[NOTIFIED_IDS_KEY]) ? result[NOTIFIED_IDS_KEY] : []);
        });
    });
}

function saveNotifiedIds(ids) {
    const storage = getStorageLocal();
    if (!storage) return Promise.resolve();

    return new Promise((resolve) => {
        storage.set({ [NOTIFIED_IDS_KEY]: ids.slice(-NOTIFIED_IDS_LIMIT) }, resolve);
    });
}

function readInstallationId() {
    const storage = getStorageLocal();
    if (!storage) return Promise.resolve(null);

    return new Promise((resolve) => {
        storage.get(['installation_id', 'user_id'], (result) => {
            resolve(result?.installation_id || result?.user_id || null);
        });
    });
}

/**
 * The badge counts price drops only, while the personal area lists the whole
 * watchlist, so callers pick which slice they need.
 */
function droppedCountOf(items) {
    return items.filter((item) => item.hasDropped).length;
}

function readTrackedCache() {
    const storage = getStorageLocal();
    if (!storage) return Promise.resolve(null);

    return new Promise((resolve) => {
        storage.get([TRACKED_CACHE_KEY], (result) => {
            const cache = result?.[TRACKED_CACHE_KEY];
            if (!cache || !Array.isArray(cache.items)) {
                resolve(null);
                return;
            }
            resolve({
                items: cache.items,
                droppedCount: Number.isFinite(Number(cache.droppedCount))
                    ? Number(cache.droppedCount)
                    : droppedCountOf(cache.items)
            });
        });
    });
}

function writeTrackedCache({ items = [], droppedCount }) {
    const storage = getStorageLocal();
    if (!storage) return Promise.resolve();

    const payload = {
        items,
        droppedCount: Number.isFinite(Number(droppedCount))
            ? Number(droppedCount)
            : droppedCountOf(items),
        savedAt: Date.now()
    };

    return new Promise((resolve) => {
        storage.set({ [TRACKED_CACHE_KEY]: payload }, resolve);
    });
}

async function upsertCachedItem(item) {
    if (!item) return;
    const cached = await readTrackedCache();
    const items = cached?.items ? [...cached.items] : [];
    const idx = items.findIndex((row) =>
        Number(row.id) === Number(item.id)
        || (item.ean && row.ean && row.ean === item.ean)
    );

    if (idx >= 0) items[idx] = { ...items[idx], ...item };
    else items.unshift(item);

    await writeTrackedCache({ items, droppedCount: droppedCountOf(items) });
}

async function removeCachedItem(id) {
    const cached = await readTrackedCache();
    if (!cached?.items?.length) return;
    const items = cached.items.filter((row) => Number(row.id) !== Number(id));
    await writeTrackedCache({ items, droppedCount: droppedCountOf(items) });
}

function fetchTrackedItems(installationId, { droppedOnly = false } = {}) {
    const query = droppedOnly ? '?droppedOnly=1' : '';
    const url = `${API_BASE}/api/alerts/${encodeURIComponent(installationId)}${query}`;

    return fetch(url).then(async (res) => {
        if (!res.ok) throw new Error(`Alerts request failed (${res.status})`);
        const data = await res.json();
        const items = Array.isArray(data.items) ? data.items : [];
        return {
            items,
            droppedCount: Number.isFinite(Number(data.droppedCount))
                ? Number(data.droppedCount)
                : droppedCountOf(items)
        };
    });
}

async function notifyPriceDrop(item, iconUrl) {
    if (!iconUrl || !chrome.notifications?.create) return;

    const price = Number(item.currentPrice).toFixed(2);
    const saved = (Number(item.originalPrice) - Number(item.currentPrice)).toFixed(2);

    chrome.notifications.create(`price-drop-${item.id}`, {
        type: 'basic',
        iconUrl,
        title: 'ירידת מחיר!',
        message: `${item.productName || item.ean}\nעכשיו ₪${price} — חסכת ₪${saved}`,
        priority: 2
    });
}

async function pollPriceDropAlerts() {
    const installationId = await readInstallationId();
    if (!installationId) return;

    let items = [];
    try {
        ({ items } = await fetchTrackedItems(installationId, { droppedOnly: true }));
    } catch (_) {
        // Server offline — leave the badge as-is and try again next alarm
        return;
    }

    setAlertBadge(items.length);
    if (!items.length) return;

    const notified = await getNotifiedIds();
    const seen = new Set(notified.map(String));
    const fresh = items.filter(item => !seen.has(String(item.id)));
    if (!fresh.length) return;

    const iconUrl = await getNotificationIcon();
    for (const item of fresh) {
        await notifyPriceDrop(item, iconUrl);
    }

    await saveNotifiedIds([...notified, ...fresh.map(item => item.id)]);
}

function openAlertsTab() {
    const base = chrome.runtime.getURL(ALERTS_PAGE);
    const url = `${base}?view=tab`;

    chrome.tabs.query({ url: `${base}*` }, (tabs) => {
        if (chrome.runtime.lastError) {
            chrome.tabs.create({ url });
            return;
        }
        if (tabs && tabs.length > 0) {
            chrome.tabs.update(tabs[0].id, { active: true });
            return;
        }
        chrome.tabs.create({ url });
    });
}

function ensureAlertAlarm() {
    chrome.alarms?.create(ALERT_ALARM, { periodInMinutes: ALERT_POLL_MINUTES });
}

chrome.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name === ALERT_ALARM) pollPriceDropAlerts();
});

chrome.notifications?.onClicked.addListener((notificationId) => {
    if (!notificationId.startsWith('price-drop-')) return;
    chrome.notifications.clear(notificationId);
    openAlertsTab();
});

chrome.runtime.onInstalled.addListener((details) => {
    ensureInstallationId();
    ensureAlertAlarm();
    pollPriceDropAlerts();

    if (details.reason === 'install') {
        isRegisteredLocally((registered) => {
            if (!registered) openRegistrationTab();
        });
    }
});

chrome.runtime.onStartup.addListener(() => {
    ensureInstallationId();
    ensureAlertAlarm();
    pollPriceDropAlerts();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'CHECK_REGISTRATION') {
        isRegisteredLocally((registered) => {
            sendResponse({ ok: true, registered });
        });
        return true;
    }

    if (message.type === 'OPEN_REGISTER') {
        openRegistrationTab();
        sendResponse({ ok: true });
        return true;
    }

    if (message.type === 'GET_REGISTRATION_STATUS') {
        const installationId = message.payload?.installation_id;
        if (!installationId) {
            sendResponse({ ok: false, error: 'installation_id required' });
            return true;
        }

        fetch(`${API_BASE}/api/users/status?installationId=${encodeURIComponent(installationId)}`)
            .then(async (res) => {
                const data = await res.json();
                sendResponse({ ok: res.ok, status: res.status, data });
            })
            .catch(error => sendResponse({ ok: false, error: error.message }));

        return true;
    }

    if (message.type === 'GET_ALERTS') {
        const installationId = message.payload?.installation_id;
        if (!installationId) {
            sendResponse({ ok: false, error: 'installation_id required' });
            return true;
        }

        fetchTrackedItems(installationId)
            .then(async ({ items, droppedCount }) => {
                await writeTrackedCache({ items, droppedCount });
                setAlertBadge(droppedCount);
                sendResponse({ ok: true, data: { items, droppedCount } });
            })
            .catch(async (error) => {
                const cached = await readTrackedCache();
                if (cached?.items?.length) {
                    sendResponse({
                        ok: true,
                        data: { ...cached, fromCache: true }
                    });
                    return;
                }
                sendResponse({ ok: false, error: error.message });
            });

        return true;
    }

    // Re-reads the watchlist so the badge matches after the popup adds or
    // removes an item, instead of waiting for the next alarm.
    if (message.type === 'REFRESH_ALERT_BADGE') {
        pollPriceDropAlerts();
        sendResponse({ ok: true });
        return true;
    }

    if (message.type === 'OPEN_ALERTS') {
        openAlertsTab();
        sendResponse({ ok: true });
        return true;
    }

    if (message.type === 'SAVE_ALERT') {
        fetch(`${API_BASE}/api/alerts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message.payload)
        })
            .then(async (res) => {
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.item) {
                    await upsertCachedItem(data.item);
                }
                sendResponse({ ok: res.ok, status: res.status, data });
            })
            .catch(error => sendResponse({ ok: false, error: error.message }));

        return true;
    }

    if (message.type === 'DELETE_ALERT') {
        const { id, userId } = message.payload || {};
        if (!id || !userId) {
            sendResponse({ ok: false, error: 'id and userId required' });
            return true;
        }

        const url = `${API_BASE}/api/alerts/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`;
        fetch(url, { method: 'DELETE' })
            .then(async (res) => {
                const data = await res.json().catch(() => ({}));
                if (res.ok) await removeCachedItem(id);
                sendResponse({ ok: res.ok, status: res.status, data });
            })
            .catch(error => sendResponse({ ok: false, error: error.message }));

        return true;
    }

    if (message.type === 'WARM_COMPARE') {
        fetch(`${API_BASE}/api/compare-warm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message.payload)
        })
            .then(async (res) => {
                const data = await res.json().catch(() => ({}));
                sendResponse({ ok: res.ok, status: res.status, data });
            })
            .catch(error => sendResponse({ ok: false, error: error.message }));

        return true;
    }

    if (message.type === 'API_REQUEST') {
        const { path, method = 'GET', body = null, headers = {} } = message.payload || {};
        if (!path || typeof path !== 'string' || !path.startsWith('/')) {
            sendResponse({ ok: false, error: 'Invalid path' });
            return true;
        }

        const init = {
            method,
            headers: { ...headers }
        };
        if (body != null && method !== 'GET') {
            init.headers['Content-Type'] = init.headers['Content-Type'] || 'application/json';
            init.body = typeof body === 'string' ? body : JSON.stringify(body);
        }

        fetch(`${API_BASE}${path}`, init)
            .then(async (res) => {
                const data = await res.json().catch(() => ({}));
                sendResponse({ ok: res.ok, status: res.status, data });
            })
            .catch((error) => {
                const offline = /Failed to fetch|NetworkError|ECONNREFUSED/i.test(String(error.message || ''));
                sendResponse({
                    ok: false,
                    error: offline
                        ? 'השרת לא רץ. הפעילי npm run start:all בתיקיית הפרויקט.'
                        : error.message
                });
            });

        return true;
    }

    if (message.type === 'TRACK_PRODUCT') {
        fetch(`${API_BASE}/api/track`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message.payload)
        })
            .then(async (res) => {
                const data = await res.json();
                sendResponse({ ok: res.ok, status: res.status, data });
            })
            .catch(error => sendResponse({ ok: false, error: error.message }));

        return true;
    }

    if (message.type === 'GET_TRACKER') {
        const installationId = message.payload?.installation_id;
        if (!installationId) {
            sendResponse({ ok: false, error: 'installation_id required' });
            return true;
        }

        fetch(`${API_BASE}/api/track/${installationId}`)
            .then(res => res.json())
            .then(data => sendResponse({ ok: true, data }))
            .catch(error => sendResponse({ ok: false, error: error.message }));

        return true;
    }

    if (message.type === 'GET_TRACK_STATUS') {
        const { installation_id, ean, source_site } = message.payload || {};
        if (!installation_id || !ean || !source_site) {
            sendResponse({ ok: false, error: 'installation_id, ean, source_site required' });
            return true;
        }

        const encodedSite = encodeURIComponent(source_site);
        fetch(`${API_BASE}/api/track/${installation_id}/${ean}/${encodedSite}`)
            .then(res => res.json())
            .then(data => sendResponse({ ok: true, data }))
            .catch(error => sendResponse({ ok: false, error: error.message }));

        return true;
    }
});
