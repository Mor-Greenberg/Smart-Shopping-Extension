// alerts.js — watchlist section of the personal area.
// Lists every tracked product; the ones whose price fell are highlighted.

const EMPTY_MESSAGE = 'עדיין אין מוצרים במעקב. הוסיפו מוצר מהפופאפ ונעדכן אתכם כשהמחיר יירד.';
const TRACKED_CACHE_KEY = 'trackedItemsCache';

const stateEl = document.getElementById('alertsState');
const listEl = document.getElementById('alertsList');
const summaryEl = document.getElementById('alertsSummary');
const backBtn = document.getElementById('backBtn');

const isTabView = new URLSearchParams(location.search).get('view') === 'tab';

let currentUserId = null;

function formatPrice(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    return `₪${num.toFixed(2)}`;
}

function siteLabel(siteKey) {
    if (!siteKey) return '';
    const entry = typeof getSiteConfig === 'function' ? getSiteConfig(siteKey) : null;
    return entry?.displayName || siteKey;
}

function showState(message, isError = false) {
    listEl.replaceChildren();
    stateEl.textContent = message;
    stateEl.classList.toggle('alerts-state--error', isError);
    stateEl.hidden = false;
    stateEl.style.display = '';
    if (summaryEl) summaryEl.hidden = true;
}

function hideLoading() {
    stateEl.hidden = true;
    stateEl.style.display = 'none';
}

function sendBackgroundMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (!response?.ok) {
                reject(new Error(response?.error || 'Request failed'));
                return;
            }
            resolve(response.data);
        });
    });
}

function readLocalCache() {
    return new Promise((resolve) => {
        try {
            chrome.storage.local.get(TRACKED_CACHE_KEY, (result) => {
                const cache = result?.[TRACKED_CACHE_KEY];
                resolve(Array.isArray(cache?.items) ? cache : null);
            });
        } catch (_) {
            resolve(null);
        }
    });
}

function refreshBadge() {
    try {
        chrome.runtime.sendMessage({ type: 'REFRESH_ALERT_BADGE' }, () => {
            void chrome.runtime.lastError;
        });
    } catch (_) {
        // Badge refresh is best-effort; the next alarm will correct it.
    }
}

function buildMedia(item) {
    const media = document.createElement('div');
    media.className = 'alert-card__media';

    if (!item.imageUrl) {
        const fallback = document.createElement('span');
        fallback.className = 'alert-card__image-fallback';
        fallback.textContent = '🛒';
        media.append(fallback);
        return media;
    }

    const img = document.createElement('img');
    img.className = 'alert-card__image';
    img.src = item.imageUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => {
        img.remove();
        const fallback = document.createElement('span');
        fallback.className = 'alert-card__image-fallback';
        fallback.textContent = '🛒';
        media.append(fallback);
    });
    media.append(img);
    return media;
}

function buildPrices(item, hasDropped) {
    const prices = document.createElement('div');
    prices.className = 'alert-card__prices';

    // Without a drop the two prices are identical, so a struck-through line
    // would just be noise.
    if (!hasDropped) {
        const label = document.createElement('span');
        label.className = 'alert-card__price-label';
        label.textContent = 'מחיר במעקב';

        const price = document.createElement('span');
        price.className = 'alert-card__price-new';
        price.textContent = formatPrice(item.currentPrice ?? item.originalPrice);

        prices.append(label, price);
        return prices;
    }

    const oldPrice = document.createElement('span');
    oldPrice.className = 'alert-card__price-old';
    oldPrice.textContent = formatPrice(item.originalPrice);

    const newPrice = document.createElement('span');
    newPrice.className = 'alert-card__price-new';
    newPrice.textContent = formatPrice(item.currentPrice);

    prices.append(oldPrice, newPrice);

    const saved = Number(item.originalPrice) - Number(item.currentPrice);
    if (saved > 0) {
        const badge = document.createElement('span');
        badge.className = 'alert-card__save';
        badge.textContent = `חסכון ${formatPrice(saved)}`;
        prices.append(badge);
    }

    return prices;
}

function buildCard(item) {
    const hasDropped = Boolean(item.hasDropped)
        && Number(item.currentPrice) < Number(item.originalPrice);

    const card = document.createElement('article');
    card.className = hasDropped ? 'alert-card alert-card--dropped' : 'alert-card';
    card.dataset.id = String(item.id);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'alert-card__remove';
    remove.setAttribute('aria-label', 'הסר מהמעקב');
    remove.textContent = '✕';
    remove.addEventListener('click', () => removeItem(item.id, card));

    const body = document.createElement('div');
    body.className = 'alert-card__body';

    const status = document.createElement('span');
    status.className = hasDropped ? 'alert-card__tag alert-card__tag--drop' : 'alert-card__tag';
    status.textContent = hasDropped ? 'ירידת מחיר!' : 'במעקב';

    const name = document.createElement('h2');
    name.className = 'alert-card__name';
    name.textContent = item.productName || item.ean || 'מוצר ללא שם';

    body.append(status, name, buildPrices(item, hasDropped));

    // The daily watch may have found the lower price at a different retailer,
    // so link to that offer when it exists.
    const targetUrl = hasDropped ? (item.bestOfferUrl || item.productUrl) : item.productUrl;
    const label = siteLabel(hasDropped ? (item.bestOfferSite || item.siteKey) : item.siteKey);

    if (label) {
        const site = document.createElement('span');
        site.className = 'alert-card__site';
        site.textContent = hasDropped ? `המחיר נמצא ב${label}` : `נשמר מ${label}`;
        body.append(site);
    }

    const cta = document.createElement('a');
    cta.className = 'alert-card__cta';
    cta.target = '_blank';
    cta.rel = 'noopener noreferrer';
    cta.textContent = 'מעבר למוצר';
    if (targetUrl) {
        try {
            cta.href = targetUrl;
        } catch (_) {
            cta.removeAttribute('href');
        }
    }
    body.append(cta);

    card.append(remove, buildMedia(item), body);
    return card;
}

function renderWatchlist(items) {
    const cards = [];
    for (const item of items) {
        try {
            cards.push(buildCard(item));
        } catch (err) {
            console.warn('[Alerts] Skipped a watchlist row:', err.message);
        }
    }

    listEl.replaceChildren(...cards);
    hideLoading();
}

function paint(items) {
    if (!items.length) {
        showState(EMPTY_MESSAGE);
        return;
    }
    renderWatchlist(items);
    updateSummary(items);
}

function updateSummary(items) {
    if (!summaryEl) return;

    const dropped = items.filter(item => item.hasDropped).length;
    summaryEl.textContent = dropped > 0
        ? `${items.length} מוצרים במעקב · ${dropped} ירדו במחיר`
        : `${items.length} מוצרים במעקב · אין ירידות מחיר כרגע`;
    summaryEl.classList.toggle('alerts-summary--hot', dropped > 0);
    summaryEl.hidden = false;
}

async function removeItem(id, card) {
    card.classList.add('alert-card--removing');

    try {
        await sendBackgroundMessage({
            type: 'DELETE_ALERT',
            payload: { id, userId: currentUserId }
        });

        card.remove();
        refreshBadge();

        if (!listEl.children.length) {
            showState(EMPTY_MESSAGE);
            return;
        }

        updateSummary([...listEl.children].map((el) => ({
            hasDropped: el.classList.contains('alert-card--dropped')
        })));
    } catch (err) {
        card.classList.remove('alert-card--removing');
        showStateInline(card, 'ההסרה נכשלה, נסו שוב');
        console.warn('[Alerts] Remove failed:', err.message);
    }
}

function showStateInline(card, message) {
    const existing = card.querySelector('.alert-card__site');
    if (existing) existing.textContent = message;
}

async function loadAlerts() {
    const cached = await readLocalCache();
    if (cached?.items?.length) {
        paint(cached.items);
    }

    try {
        const data = await sendBackgroundMessage({
            type: 'GET_ALERTS',
            payload: { installation_id: currentUserId }
        });
        const items = Array.isArray(data?.items) ? data.items : [];
        paint(items);
        refreshBadge();
    } catch (err) {
        if (cached?.items?.length) return;
        showState('לא הצלחנו לטעון את ההתראות. ודאו שהשרת פועל ונסו שוב.', true);
        console.warn('[Alerts] Load failed:', err.message);
    }
}

backBtn.addEventListener('click', () => {
    if (isTabView) {
        window.close();
        return;
    }
    location.replace('popup.html');
});

document.addEventListener('DOMContentLoaded', async () => {
    if (!(await ensureRegistered())) return;

    document.body.hidden = false;

    try {
        currentUserId = await getOrCreateInstallationId();
    } catch (err) {
        showState('לא הצלחנו לזהות את המשתמש.', true);
        return;
    }

    loadAlerts();
});
