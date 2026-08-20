// auth.js — registration helpers (popup + register page)
//
// Domain split (do not mix):
//   consumer_clubs table → loyalty / employee clubs stored on the User profile,
//                          served by GET /api/clubs. No client-side copy exists:
//                          the DB is the only source of truth.
//   SITES_CONFIG         → retail sites used for scraping / price comparison

const AUTH_API_BASE = 'http://localhost:3000';

const COUNTRY_OPTIONS = [
    { value: 'IL', label: 'Israel 🇮🇱' },
    { value: 'US', label: 'USA 🇺🇸' }
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value) {
    return EMAIL_RE.test(String(value || '').trim());
}

function getStorageLocal() {
    try {
        return globalThis.chrome?.storage?.local || null;
    } catch (_) {
        return null;
    }
}

function getOrCreateInstallationId() {
    const storage = getStorageLocal();
    if (!storage) {
        return Promise.reject(new Error('chrome.storage is unavailable'));
    }

    return new Promise((resolve, reject) => {
        try {
            storage.get(['installation_id', 'user_id'], (result) => {
                if (chrome.runtime?.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (result?.installation_id) {
                    resolve(result.installation_id);
                    return;
                }
                if (result?.user_id) {
                    storage.set({ installation_id: result.user_id }, () => {
                        resolve(result.user_id);
                    });
                    return;
                }
                const newId = crypto.randomUUID();
                storage.set({ installation_id: newId }, () => resolve(newId));
            });
        } catch (err) {
            reject(err);
        }
    });
}

function getStoredUserProfile() {
    const storage = getStorageLocal();
    if (!storage) return Promise.resolve(null);

    return new Promise((resolve) => {
        try {
            storage.get(['userProfile'], (result) => {
                resolve(result?.userProfile || null);
            });
        } catch (_) {
            resolve(null);
        }
    });
}

function hasLocalUserData(profile) {
    return Boolean(profile?.registrationComplete && profile?.userId && profile?.email);
}

function saveUserProfile(user, installationId) {
    const profile = {
        userId: user.id,
        email: user.email,
        country: user.country || null,
        consumerClubs: user.consumerClubs || [],
        isAdmin: Boolean(user.isAdmin),
        registrationComplete: true,
        installationId
    };

    const storage = getStorageLocal();
    if (!storage) {
        return Promise.reject(new Error('chrome.storage is unavailable'));
    }

    return new Promise((resolve, reject) => {
        try {
            storage.set({ userProfile: profile }, () => resolve(profile));
        } catch (err) {
            reject(err);
        }
    });
}

function isRegisterPage() {
    return typeof location !== 'undefined' && /register\.html$/i.test(location.pathname);
}

function redirectToRegistration() {
    if (isRegisterPage()) return;
    location.replace(chrome.runtime.getURL('register.html'));
}

async function ensureRegistered() {
    if (isRegisterPage()) return true;

    const profile = await getStoredUserProfile();
    if (hasLocalUserData(profile)) return true;

    redirectToRegistration();
    return false;
}

if (typeof window !== 'undefined') {
    window.AUTH_API_BASE = AUTH_API_BASE;
    window.COUNTRY_OPTIONS = COUNTRY_OPTIONS;
    window.isValidEmail = isValidEmail;
    window.getOrCreateInstallationId = getOrCreateInstallationId;
    window.getStoredUserProfile = getStoredUserProfile;
    window.saveUserProfile = saveUserProfile;
    window.ensureRegistered = ensureRegistered;
    window.redirectToRegistration = redirectToRegistration;
}
