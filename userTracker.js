const sessionId = crypto.randomUUID();
const ALLOWED_SHOPPING_HOSTS = [
  "adidas.co.il",
  "adidas.com",
  "terminalx.com",
  "nike.com",
  "super-pharm.co.il"
];

function isAllowedShoppingHost(hostname) {
  const normalizedHostname = (hostname || "").toLowerCase().replace(/^www\./, "");
  return ALLOWED_SHOPPING_HOSTS.some((allowedHost) => {
    return normalizedHostname === allowedHost || normalizedHostname.endsWith(`.${allowedHost}`);
  });
}
function getOrCreateUserId(callback) {
  chrome.storage.local.get(["user_id"], (result) => {
    if (result.user_id) {
      callback(result.user_id);
      return;
    }

    const newUserId = crypto.randomUUID();

    chrome.storage.local.set({ user_id: newUserId }, () => {
      callback(newUserId);
    });
  });
}

function sendMessageToBackground(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (!response || !response.ok) {
        reject(response?.error || "Background request failed");
        return;
      }

      resolve(response.data);
    });
  });
}

function getMetaContent(selector) {
  return document.querySelector(selector)?.content?.trim() || "";
}

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function getBrandFromHostname(hostname) {
  const normalizedHostname = (hostname || "").toLowerCase().replace(/^www\./, "");

  if (normalizedHostname.endsWith("adidas.co.il") || normalizedHostname.endsWith("adidas.com")) return "adidas";
  if (normalizedHostname.endsWith("terminalx.com")) return "terminalx";
  if (normalizedHostname.endsWith("nike.com")) return "nike";
  if (normalizedHostname.endsWith("super-pharm.co.il")) return "super-pharm";

  return "unknown";
}

function getCurrentProductContext() {
  const title =
    getMetaContent('meta[property="og:title"]') ||
    getMetaContent('meta[name="title"]') ||
    document.querySelector("h1")?.textContent ||
    document.title ||
    "unknown";

  return {
    brand: getBrandFromHostname(window.location.hostname),
    product_name: normalizeText(title),
    source_url: window.location.href
  };
}

async function trackUserEvent(eventType, durationSeconds) {
  if (!isAllowedShoppingHost(window.location.hostname)) {
    return;
  }

  if (durationSeconds <= 0) {
    return;
  }

  getOrCreateUserId((userId) => {
    const context = getCurrentProductContext();

    (async () => {
      try {
        const productData = await sendMessageToBackground({
          type: "FIND_OR_CREATE_PRODUCT",
          payload: {
            brand: context.brand || "unknown",
            product_name: context.product_name || document.title || "unknown",
            source_url: window.location.href
          }
        });

        if (!productData.product_id) {
          throw new Error("Product id was not returned from FIND_OR_CREATE_PRODUCT");
        }

        const trackingPayload = {
          user_id: userId,
          product_id: productData.product_id,
          event_type: eventType,
          duration_seconds: durationSeconds,
          session_id: sessionId
        };

        const eventResponse = await sendMessageToBackground({
          type: "TRACK_EVENT",
          payload: trackingPayload
        });
      } catch (error) {
        console.error("Tracking failed:", error);
      }
    })();
  });
}

let activeSeconds = 0;
let lastSentDuration = 0;
let lastActivityTime = null;

const ACTIVE_THRESHOLD_MS = 5000;
const MIN_ACTIVE_SECONDS_TO_SAVE = 10;

function markUserActive() {
  if (document.visibilityState !== "visible") return;
  lastActivityTime = Date.now();
}

function isUserCurrentlyActive() {
  return (
    document.visibilityState === "visible" &&
    lastActivityTime !== null &&
    Date.now() - lastActivityTime <= ACTIVE_THRESHOLD_MS
  );
}

["mousemove", "click", "scroll", "keydown", "touchstart"].forEach((eventName) => {
  document.addEventListener(eventName, markUserActive, { passive: true });
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") {
    lastActivityTime = null;
  }
});

setInterval(() => {
  if (isUserCurrentlyActive()) {
    activeSeconds++;
  }

}, 1000);

setInterval(() => {
  if (activeSeconds >= MIN_ACTIVE_SECONDS_TO_SAVE && activeSeconds > lastSentDuration) {
    const newActiveSeconds = activeSeconds - lastSentDuration;
    lastSentDuration = activeSeconds;

    trackUserEvent("view", newActiveSeconds);
  }
}, 10000);
