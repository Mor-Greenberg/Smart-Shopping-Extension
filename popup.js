// popup.js

// Do not wait for DOMContentLoaded — a hidden body is sized as 0px by Chrome.
if (document.body) document.body.hidden = false;

const API_BASE = 'http://localhost:3000';

const CONFETTI_COLORS = ['#450693', '#8C00FF', '#FF3F7F', '#FFC400', '#12b76a', '#ffffff'];
let confettiFired = false;
let currentSitePrice = null;

// Which consumer clubs each retail site honours, as configured by the admin.
let siteClubsMap = {};
// The clubs this user actually belongs to — badges are personal, not the full site list.
let myClubNames = new Set();

function clubNameKey(name) {
    return String(name || '').trim().toLowerCase();
}

/**
 * Kept in storage so the badges still render when the server is unreachable.
 * The request starts as soon as the popup script loads and is awaited later.
 */
const siteClubsReady = (async () => {
    try {
        const cached = await chrome.storage.local.get(['siteClubsCache', 'userProfile']);
        if (cached?.siteClubsCache) siteClubsMap = cached.siteClubsCache;
        if (Array.isArray(cached?.userProfile?.consumerClubs)) {
            myClubNames = new Set(cached.userProfile.consumerClubs.map(clubNameKey));
        }
    } catch (_) { /* first run */ }

    try {
        const res = await fetch(`${API_BASE}/api/site-clubs`);
        if (!res.ok) return;
        const data = await res.json();
        if (data && typeof data.siteClubs === 'object') {
            siteClubsMap = data.siteClubs;
            try {
                // Callback form: .set() may not return a Promise in all Chrome builds.
                chrome.storage.local.set({ siteClubsCache: siteClubsMap }, () => {
                    void chrome.runtime?.lastError;
                });
            } catch (_) { /* storage write is optional */ }
        }
    } catch (_) { /* offline: cached map stays in place */ }
})();

function clubsForSite(siteKey) {
    if (!siteKey) return [];
    const variants = [
        siteKey,
        siteKey.replace(/^www\./, ''),
        siteKey.startsWith('www.') ? siteKey : `www.${siteKey}`
    ];
    let siteClubs = [];
    for (const key of variants) {
        if (Array.isArray(siteClubsMap[key]) && siteClubsMap[key].length) {
            siteClubs = siteClubsMap[key];
            break;
        }
    }
    if (!siteClubs.length || !myClubNames.size) return [];
    return siteClubs.filter((club) => myClubNames.has(clubNameKey(club.name)));
}

function createClubStrip(siteKey, variant = 'deal') {
    const clubs = clubsForSite(siteKey);
    if (!clubs.length) return null;

    const strip = document.createElement('span');
    strip.className = `club-strip club-strip--${variant}`;

    clubs.slice(0, 5).forEach((club) => {
        const badge = document.createElement('span');
        badge.className = 'club-badge';
        badge.title = `מועדון ${club.name}`;

        if (club.logoUrl) {
            const img = document.createElement('img');
            img.src = club.logoUrl;
            img.alt = club.name;
            // Fall back to initials rather than leaving an empty circle.
            img.onerror = () => {
                img.remove();
                badge.textContent = club.initials || club.name.slice(0, 2);
            };
            badge.appendChild(img);
        } else {
            badge.textContent = club.initials || club.name.slice(0, 2);
        }

        strip.appendChild(badge);
    });

    return strip;
}

function sanitizePrice(value) {
    if (value == null || value === '') return null;

    if (typeof value === 'number') {
        return Number.isFinite(value) && value > 0 && value < 100000 ? value : null;
    }

    const normalized = String(value).replace(/\s+/g, ' ').trim();
    if (!/\d/.test(normalized)) return null;

    const shekelPatterns = [
        /₪\s*([\d,]+(?:\.\d{1,2})?)/,
        /([\d,]+(?:\.\d{1,2})?)\s*₪/
    ];
    for (const pattern of shekelPatterns) {
        const match = normalized.match(pattern);
        if (match) {
            const val = parseFloat(match[1].replace(/,/g, ''));
            if (Number.isFinite(val) && val > 0 && val < 100000) return val;
        }
    }

    const numeric = normalized.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/);
    if (numeric) {
        const val = parseFloat(numeric[1].replace(/,/g, ''));
        if (Number.isFinite(val) && val > 0 && val < 100000) return val;
    }

    return null;
}

function formatDisplayPrice(price) {
    const val = sanitizePrice(price);
    if (val == null) return null;
    return val % 1 === 0 ? String(val) : val.toFixed(2);
}

async function refreshAdminFlag(profile) {
    if (!profile?.installationId || typeof saveUserProfile !== 'function') return profile;
    try {
        const res = await fetch(
            `${API_BASE}/api/users/status?installationId=${encodeURIComponent(profile.installationId)}`
        );
        const data = await res.json();
        if (data.user) {
            await saveUserProfile(data.user, profile.installationId);
            return {
                ...profile,
                isAdmin: Boolean(data.user.isAdmin),
                userId: data.user.id,
                email: data.user.email
            };
        }
    } catch (_) {}
    return profile;
}

const STALE_RETRY_DELAYS_MS = [400, 800, 1200];

function requestProductData(tabId) {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { action: 'GET_PRODUCT_DATA' }, (response) => {
            resolve(chrome.runtime.lastError ? null : (response || null));
        });
    });
}

/**
 * A soft navigation can leave the previous product in the DOM for a moment, so
 * the content script flags that case and we wait for the page to catch up.
 */
async function getFreshProductData(tabId) {
    let response = await requestProductData(tabId);

    for (const delay of STALE_RETRY_DELAYS_MS) {
        if (!response?.stale) break;
        await new Promise(resolve => setTimeout(resolve, delay));
        response = await requestProductData(tabId);
    }

    return response;
}

document.addEventListener('DOMContentLoaded', async () => {
    document.body.hidden = false;
    document.documentElement.style.width = '400px';
    document.body.style.width = '400px';

    try {
        if (!(await ensureRegistered())) return;
    } catch (err) {
        console.warn('[Auth] Registration check failed:', err?.message || err);
        redirectToRegistration();
        return;
    }
    document.getElementById('closePopupBtn')?.addEventListener('click', () => window.close());
    document.getElementById('personalAreaBtn')?.addEventListener('click', () => {
        location.replace('alerts.html');
    });

    const profile = await refreshAdminFlag(await getStoredUserProfile());
    const adminBtn = document.getElementById('adminDashboardBtn');
    if (profile?.isAdmin && adminBtn) {
        adminBtn.hidden = false;
        adminBtn.addEventListener('click', () => {
            location.replace(chrome.runtime.getURL('admin-dashboard.html'));
        });
    } else if (adminBtn) {
        adminBtn.hidden = true;
    }

    // Independent of the current tab: drops should show even on an unsupported page.
    getOrCreateInstallationId()
        .then(loadPriceDrops)
        .catch(() => {});

    const container = document.getElementById('dynamicButtonsContainer');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
        container.innerHTML = '<div class="info-text">לא ניתן לגשת לטאב</div>';
        return;
    }

    let currentHostname = '';
    try {
        currentHostname = new URL(tab.url).hostname;
    } catch (_) {
        container.innerHTML = '<div class="info-text">כתובת לא תקינה</div>';
        return;
    }

    const siteConfig = typeof getSiteConfig === 'function'
        ? getSiteConfig(currentHostname)
        : SITES_CONFIG[currentHostname];

    if (!siteConfig) {
        container.innerHTML = '<div class="info-text">האתר אינו נתמך כרגע</div>';
        return;
    }

    await siteClubsReady;
    renderHeroClubs(currentHostname);

    const response = await getFreshProductData(tab.id);

    if (!response) {
        container.innerHTML = '<div class="info-text">לא ניתן לקרוא נתונים מהדף</div>';
        return;
    }

    // Comparing the wrong product is worse than showing nothing.
    if (response.stale) {
        container.innerHTML =
            '<div class="info-text">הדף עדיין מציג את המוצר הקודם. רעננו את הדף ונסו שוב</div>';
        return;
    }

    currentSitePrice = sanitizePrice(response.price);

    if (!response.ean || response.ean === 'unknown_sku') {
        const noEanMsg = siteConfig?.noEanMessage || 'לא נמצא ברקוד במוצר';
        container.innerHTML = `<div class="info-text">${noEanMsg}</div>`;
        updateProductInfo(response);
        return;
    }

    updateProductInfo(response);
    setupActiveTracking(response, canonicalSiteKey(currentHostname), response.url || tab.url).catch(() => {});

    const currentKeys = new Set([
        currentHostname,
        currentHostname.replace(/^www\./, ''),
        currentHostname.startsWith('www.') ? currentHostname : `www.${currentHostname}`
    ]);

    const targetSites = Object.keys(SITES_CONFIG).filter(site => {
        const cfg = SITES_CONFIG[site];
        if (typeof isSiteEnabled === 'function' && !isSiteEnabled(cfg)) return false;
        if (cfg.enabled === false) return false;
        if (currentKeys.has(site)) return false;
        if (cfg.siteType !== 'retail') return false;
        if (cfg.compareRole === 'origin-only') return false;
        return true;
    });

    if (targetSites.length === 0) {
        container.innerHTML = '<div class="info-text">אין אתרים נוספים להשוואה</div>';
        return;
    }

    container.innerHTML = `
        <div class="loading-state">
            <span class="loading-state__dot"></span>
            <span class="loading-state__text">בודק זמינות באתרים אחרים...</span>
        </div>`;

    await buildComparisonButtons(
        response.ean,
        response.productName,
        targetSites,
        container,
        {
            sourceSite: canonicalSiteKey(currentHostname),
            sourcePrice: currentSitePrice,
            sourceUrl: response.url || tab.url
        }
    );
});

/**
 * Inserts a space at Latin↔Hebrew script boundaries so mixed product names
 * render correctly (e.g. "Xerjoffיוניסקס" → "Xerjoff יוניסקס").
 */
function fixMixedScriptSpacing(text) {
    if (!text) return text;

    return String(text)
        .replace(/([\u0590-\u05FF])([A-Za-z0-9])/g, '$1 $2')
        .replace(/([A-Za-z0-9])([\u0590-\u05FF])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
}

function renderHeroClubs(siteKey) {
    const host = document.getElementById('heroClubs');
    if (!host) return;

    host.replaceChildren();
    const strip = createClubStrip(siteKey, 'hero');
    if (!strip) {
        host.hidden = true;
        return;
    }

    const label = document.createElement('span');
    label.className = 'club-strip__label';
    label.textContent = 'מועדונים:';
    host.appendChild(label);
    while (strip.firstChild) host.appendChild(strip.firstChild);
    host.hidden = false;
}

function updateProductInfo(data) {
    const productEl = document.getElementById('productName');
    const eanEl = document.getElementById('eanValue');
    const imgEl = document.getElementById('productImage');
    const imgFallback = document.getElementById('productImageFallback');

    if (productEl) {
        productEl.textContent = fixMixedScriptSpacing(data.productName) || '-';
    }
    if (eanEl) eanEl.textContent = data.ean || '-';

    if (imgEl && imgFallback) {
        if (data.imageUrl) {
            imgEl.src = data.imageUrl;
            imgEl.alt = fixMixedScriptSpacing(data.productName) || 'Product image';
            imgEl.onerror = () => {
                imgEl.hidden = true;
                imgFallback.hidden = false;
            };
            imgEl.hidden = false;
            imgFallback.hidden = true;
        } else {
            imgEl.hidden = true;
            imgEl.removeAttribute('src');
            imgFallback.hidden = false;
        }
    }
}

function sendBackgroundMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError.message);
                return;
            }
            if (!response?.ok) {
                reject(response?.error || 'Request failed');
                return;
            }
            resolve(response.data);
        });
    });
}

/**
 * The popup only advertises how many drops are waiting; the cards themselves
 * live on the dedicated alerts page.
 */
async function loadPriceDrops(installationId) {
    const button = document.getElementById('viewAlertsBtn');
    const counter = document.getElementById('viewAlertsCount');
    const headerCount = document.getElementById('personalAreaCount');
    if (!installationId || !button) return;

    try {
        const data = await sendBackgroundMessage({
            type: 'GET_ALERTS',
            payload: { installation_id: installationId }
        });

        const items = data?.items || [];
        const dropped = Number(data?.droppedCount) || 0;

        if (!items.length) {
            button.hidden = true;
            if (counter) counter.hidden = true;
            if (headerCount) headerCount.hidden = true;
            return;
        }

        // A number is a price-drop alert, so it stays off while nothing dropped.
        if (counter) {
            counter.textContent = String(dropped);
            counter.hidden = dropped === 0;
        }
        if (headerCount) {
            headerCount.textContent = String(dropped);
            headerCount.hidden = dropped === 0;
        }

        const label = button.querySelector('.drop-link__text');
        if (label) {
            label.textContent = dropped > 0
                ? 'צפייה בירידות מחיר'
                : `המוצרים שבמעקב (${items.length})`;
        }
        button.classList.toggle('drop-link--hot', dropped > 0);

        button.hidden = false;
        button.addEventListener('click', () => {
            location.replace('alerts.html');
        });
    } catch (_) {
        // Server offline — the alerts card just stays empty
    }
}

function canonicalSiteKey(hostname) {
    if (typeof resolveSiteEntry === 'function') {
        return resolveSiteEntry(hostname)?.key || hostname;
    }
    if (typeof SITES_CONFIG !== 'undefined' && SITES_CONFIG[hostname]) return hostname;
    const withoutWww = String(hostname || '').replace(/^www\./, '');
    if (typeof SITES_CONFIG !== 'undefined' && SITES_CONFIG[withoutWww]) return withoutWww;
    return hostname;
}

async function setupActiveTracking(productData, sourceSite, sourceUrl) {
    const alertBtn = document.getElementById('createAlertBtn');
    const alertStatus = document.getElementById('alertStatus');
    if (!alertBtn) return;

    const installationId = await getOrCreateInstallationId();

    try {
        const status = await sendBackgroundMessage({
            type: 'GET_TRACK_STATUS',
            payload: {
                installation_id: installationId,
                ean: productData.ean,
                source_site: sourceSite
            }
        });

        if (status.tracked) {
            alertBtn.disabled = true;
            alertBtn.textContent = status.tracking_type === 'active'
                ? 'מעקב פעיל'
                : 'נצפה לאחרונה';
            if (alertStatus) {
                alertStatus.textContent = 'המוצר כבר ברשימת המעקב שלך';
                alertStatus.className = 'alert-status';
            }
        }
    } catch (_) {
        // Server offline — button still usable
    }

    alertBtn.addEventListener('click', async () => {
        alertBtn.disabled = true;
        try {
            await sendBackgroundMessage({
                type: 'TRACK_PRODUCT',
                payload: {
                    installation_id: installationId,
                    ean: productData.ean,
                    source_site: sourceSite,
                    tracking_type: 'active',
                    source_url: sourceUrl,
                    product_name: productData.productName,
                    brand: productData.brand,
                    extension_version: chrome.runtime.getManifest().version,
                    locale: navigator.language,
                    platform: navigator.platform
                }
            });

            // Watchlist row that powers the alerts page.
            const priceToSave = currentSitePrice || sanitizePrice(productData.price);
            if (!(priceToSave > 0)) {
                throw new Error('לא נמצא מחיר לשמירה מהדף');
            }

            await sendBackgroundMessage({
                type: 'SAVE_ALERT',
                payload: {
                    userId: installationId,
                    url: sourceUrl,
                    name: productData.productName,
                    image: productData.imageUrl,
                    originalPrice: priceToSave,
                    ean: productData.ean,
                    siteKey: sourceSite
                }
            });

            alertBtn.textContent = 'מעקב פעיל';
            if (alertStatus) {
                alertStatus.textContent = 'המוצר נשמר למעקב';
                alertStatus.className = 'alert-status';
            }
        } catch (err) {
            alertBtn.disabled = false;
            if (alertStatus) {
                alertStatus.textContent = err.message || 'שגיאה בשמירה למעקב';
                alertStatus.className = 'alert-status alert-status--error';
            }
            console.error('Active track failed:', err);
        }
    });
}

function findBestDealSites(results) {
    const current = sanitizePrice(currentSitePrice);
    if (current == null) return new Set();

    const priced = results
        .map(r => ({ ...r, price: sanitizePrice(r.price) }))
        .filter(r => r.price != null);

    if (!priced.length) return new Set();

    const minPrice = Math.min(...priced.map(r => r.price));
    if (minPrice >= current) return new Set();

    return new Set(
        priced.filter(r => r.price === minPrice).map(r => r.site)
    );
}

function createPriceButton(site, price, productUrl, isBestDeal = false) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = isBestDeal ? 'deal-btn deal-btn--best' : 'deal-btn deal-btn--primary';

    const label = document.createElement('span');
    const siteName = SITES_CONFIG[site]?.displayName || site;
    label.textContent = `${siteName}: ₪${price}`;
    btn.appendChild(label);

    const clubs = createClubStrip(site, 'deal');
    if (clubs) btn.appendChild(clubs);

    if (isBestDeal) {
        const badge = document.createElement('span');
        badge.className = 'deal-btn__badge';
        badge.textContent = 'הכי זול';
        btn.appendChild(badge);
    }

    btn.addEventListener('click', () => {
        chrome.tabs.create({ url: productUrl });
    });
    return btn;
}

function createFallbackButton(site, productUrl) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'deal-btn deal-btn--outline';

    const label = document.createElement('span');
    label.textContent = `צפה ב-${SITES_CONFIG[site]?.displayName || site}`;
    btn.appendChild(label);

    const clubs = createClubStrip(site, 'deal');
    if (clubs) btn.appendChild(clubs);

    btn.addEventListener('click', () => {
        chrome.tabs.create({ url: productUrl });
    });
    return btn;
}

function createGenericLoadingMessage() {
    const row = document.createElement('div');
    row.className = 'loading-state';
    row.id = 'compareStreamLoading';
    row.innerHTML = `
        <span class="loading-state__dot"></span>
        <span class="loading-state__text">ממשיכים לחפש באתרים נוספים...</span>`;
    return row;
}

function streamResultToEntry(data) {
    const site = data.site;
    const price = data.price ?? data.cachedPrice ?? null;
    const productUrl = data.productUrl || null;

    if (!data.exists || !productUrl || productUrl.toLowerCase().includes('/search')) {
        return null;
    }

    return {
        site,
        price: sanitizePrice(price),
        productUrl
    };
}

function parseSSEBlock(block) {
    let event = 'message';
    let data = '';

    for (const line of block.split('\n')) {
        if (line.startsWith('event:')) {
            event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
            data += line.slice(5).trim();
        }
    }

    if (!data) return { event, data: null };

    try {
        return { event, data: JSON.parse(data) };
    } catch (_) {
        return { event, data: null };
    }
}

function createSSEParser() {
    let buffer = '';

    return {
        feed(chunk) {
            buffer += chunk;
            const events = [];
            let boundary;

            while ((boundary = buffer.indexOf('\n\n')) !== -1) {
                const block = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                events.push(parseSSEBlock(block));
            }

            return events;
        }
    };
}

function maybeCelebrateCheaperDeal(results) {
    const current = sanitizePrice(currentSitePrice);
    if (confettiFired || current == null) return;

    const priced = results
        .map(r => sanitizePrice(r.price))
        .filter(p => p != null);

    if (!priced.some(p => p < current)) return;

    confettiFired = true;
    launchConfetti();
}

function launchConfetti() {
    const canvas = document.getElementById('confettiCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    ctx.scale(dpr, dpr);

    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    const particles = Array.from({ length: 90 }, () => ({
        x: w * 0.5 + (Math.random() - 0.5) * 80,
        y: h * 0.35,
        vx: (Math.random() - 0.5) * 6,
        vy: Math.random() * -7 - 3,
        size: Math.random() * 6 + 3,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        rotation: Math.random() * 360,
        spin: (Math.random() - 0.5) * 12,
        life: 1
    }));

    const start = performance.now();
    const duration = 2200;

    function frame(now) {
        const elapsed = now - start;
        const progress = elapsed / duration;
        ctx.clearRect(0, 0, w, h);

        for (const p of particles) {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.18;
            p.rotation += p.spin;
            p.life = Math.max(0, 1 - progress);

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate((p.rotation * Math.PI) / 180);
            ctx.globalAlpha = p.life;
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
            ctx.restore();
        }

        if (elapsed < duration) {
            requestAnimationFrame(frame);
        } else {
            ctx.clearRect(0, 0, w, h);
        }
    }

    requestAnimationFrame(frame);
}

function appendDealButtons(container, results, loadingEl) {
    container.querySelectorAll('.deal-btn').forEach(el => el.remove());

    const bestSites = findBestDealSites(results);
    const withPrice = results.filter(r => sanitizePrice(r.price) != null);
    const withoutPrice = results.filter(r => sanitizePrice(r.price) == null);

    withPrice
        .sort((a, b) => sanitizePrice(a.price) - sanitizePrice(b.price))
        .forEach(({ site, price, productUrl }) => {
            const displayPrice = formatDisplayPrice(price);
            container.insertBefore(
                createPriceButton(site, displayPrice, productUrl, bestSites.has(site)),
                loadingEl?.parentNode === container ? loadingEl : null
            );
        });

    withoutPrice.forEach(({ site, productUrl }) => {
        container.insertBefore(
            createFallbackButton(site, productUrl),
            loadingEl?.parentNode === container ? loadingEl : null
        );
    });

    maybeCelebrateCheaperDeal(results);
}

function getCompareNotFoundMessage() {
    return (typeof COMPARE_UI_CONFIG !== 'undefined' && COMPARE_UI_CONFIG.notFoundMessage)
        || 'המוצר לא נמצא באתרים אחרים';
}

function getCompareSearchTimeoutMs() {
    const configured = typeof COMPARE_UI_CONFIG !== 'undefined' && COMPARE_UI_CONFIG.searchTimeoutMs;
    return Number.isFinite(configured) && configured > 0 ? configured : 30000;
}

function renderComparisonResults(container, results) {
    container.innerHTML = '';

    const withPrice = results.filter(r => r.price > 0);
    const withoutPrice = results.filter(r => !r.price || r.price <= 0);

    if (withPrice.length === 0 && withoutPrice.length === 0) {
        container.innerHTML = `<div class="info-text">${getCompareNotFoundMessage()}</div>`;
        return;
    }

    appendDealButtons(container, results, null);
}

function updatePendingLoading(container, pendingCount, loadingEl) {
    if (pendingCount > 0) {
        if (!loadingEl.parentNode) {
            container.appendChild(loadingEl);
        }
        return;
    }

    if (loadingEl.parentNode) {
        loadingEl.remove();
    }
}

function persistOriginOffer({ ean, siteKey, productUrl, price, productName }) {
    if (!ean || !siteKey || !productUrl) return;
    fetch(`${API_BASE}/api/offers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ean, siteKey, productUrl, price, productName })
    }).catch(() => {});
}

async function buildComparisonButtons(ean, sourceProductName, targetSites, container, sourceMeta = {}) {
    persistOriginOffer({
        ean,
        siteKey: sourceMeta.sourceSite,
        productUrl: sourceMeta.sourceUrl,
        price: sourceMeta.sourcePrice,
        productName: sourceProductName
    });

    const sitesSettings = {};
    for (const site of targetSites) {
        sitesSettings[site] = SITES_CONFIG[site];
    }

    let installationId = null;
    try {
        installationId = await getOrCreateInstallationId();
    } catch (_) { /* analytics is optional */ }

    const results = [];
    let pendingLiveCount = targetSites.length;
    const loadingEl = createGenericLoadingMessage();
    const timeoutMs = getCompareSearchTimeoutMs();
    const abortController = new AbortController();
    let finished = false;
    let timeoutHandle = null;

    const applyEntry = (entry) => {
        if (!entry || finished) return;
        const existing = results.findIndex((row) => row.site === entry.site);
        if (existing >= 0) results[existing] = entry;
        else results.push(entry);
        appendDealButtons(container, results, loadingEl);
    };

    const finishCompare = (reason = 'complete') => {
        if (finished) return;
        finished = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);

        updatePendingLoading(container, 0, loadingEl);

        if (results.length === 0) {
            if (reason === 'timeout') {
                console.log('[Smart Shopping] Compare search TIMEOUT', { ean, timeoutMs });
            }
            container.innerHTML = `<div class="info-text">${getCompareNotFoundMessage()}</div>`;
            return;
        }

        appendDealButtons(container, results, null);
    };

    container.innerHTML = '';
    container.appendChild(loadingEl);

    timeoutHandle = setTimeout(() => {
        abortController.abort();
        finishCompare('timeout');
    }, timeoutMs);

    try {
        const response = await fetch(`${API_BASE}/api/compare-stream`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream'
            },
            body: JSON.stringify({
                ean,
                compareWith: targetSites,
                sourceProductName,
                sitesSettings,
                sourceSite: sourceMeta.sourceSite || null,
                sourcePrice: sourceMeta.sourcePrice ?? null,
                sourceUrl: sourceMeta.sourceUrl || null,
                installationId
            }),
            signal: abortController.signal
        });

        if (!response.ok || !response.body) {
            throw new Error(`Stream failed: HTTP ${response.status}`);
        }

        const parser = createSSEParser();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            for (const evt of parser.feed(decoder.decode(value, { stream: true }))) {
                if (finished) break;

                if (evt.event === 'progress' && evt.data?.pending != null) {
                    pendingLiveCount = evt.data.pending;
                    updatePendingLoading(container, pendingLiveCount, loadingEl);
                } else if (evt.event === 'result' && evt.data?.site) {
                    applyEntry(streamResultToEntry(evt.data));
                    if (!evt.data.fromCache) {
                        pendingLiveCount = Math.max(0, pendingLiveCount - 1);
                        updatePendingLoading(container, pendingLiveCount, loadingEl);
                    }
                } else if (evt.event === 'error' && evt.data?.site) {
                    pendingLiveCount = Math.max(0, pendingLiveCount - 1);
                    updatePendingLoading(container, pendingLiveCount, loadingEl);
                } else if (evt.event === 'done') {
                    pendingLiveCount = 0;
                    updatePendingLoading(container, pendingLiveCount, loadingEl);
                }
            }

            if (finished) break;
        }

        if (!finished) {
            finishCompare('complete');
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            if (!finished) finishCompare('timeout');
            return;
        }

        console.warn('Compare stream failed:', err?.message || err);
        if (results.length) {
            if (!finished) finishCompare('complete');
            return;
        }
        if (timeoutHandle) clearTimeout(timeoutHandle);
        container.innerHTML = '<div class="info-text">שגיאה בחיבור לשרת</div>';
    }
}
