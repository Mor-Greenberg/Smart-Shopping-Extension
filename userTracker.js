console.log("userTracker loaded");
const sessionId = crypto.randomUUID();
function getOrCreateUserId(callback) {
  chrome.storage.local.get(["user_id"], (result) => {
    if (result.user_id) {
      callback(result.user_id);
      return;
    }

    const newUserId = crypto.randomUUID();

    chrome.storage.local.set({ user_id: newUserId }, () => {
      console.log("New user created:", newUserId);
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

function getCurrentProductContext(callback) {
  chrome.storage.local.get(["current_product_context"], (result) => {
    callback(result.current_product_context || {});
  });
}

async function trackUserEvent(eventType, durationSeconds) {
  if (durationSeconds < 10) {
    console.log("Event ignored: duration too short");
    return;
  }

  getOrCreateUserId((userId) => {
    getCurrentProductContext(async (context) => {
      try {
        const productData = await sendMessageToBackground({
          type: "FIND_OR_CREATE_PRODUCT",
          payload: {
            brand: context.brand || "unknown",
            product_name: context.product_name || document.title || "unknown",
            source_url: context.source_url || window.location.href
          }
        });

        const eventResponse = await sendMessageToBackground({
          type: "TRACK_EVENT",
payload: {
  user_id: userId,
  product_id: productData.product_id,
  event_type: eventType,
  duration_seconds: durationSeconds,
  session_id: sessionId
}
        });

        console.log("Tracking response:", eventResponse);
      } catch (error) {
        console.error("Tracking failed:", error);
      }
    });
  });
}

let startTime = Date.now();
let lastSentDuration = 0;

setInterval(() => {
  const durationSeconds = Math.floor((Date.now() - startTime) / 1000);

  if (durationSeconds >= 10 && durationSeconds !== lastSentDuration) {
    lastSentDuration = durationSeconds;

    console.log("Tracking real duration:", durationSeconds);

    trackUserEvent("view", durationSeconds);
  }
}, 10000);