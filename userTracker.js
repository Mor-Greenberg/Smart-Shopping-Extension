console.log("userTracker loaded");

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

function trackUserEvent(productId, eventType, durationSeconds) {
  if (durationSeconds < 10) {
    console.log("Event ignored: duration too short");
    return;
  }

  getOrCreateUserId((userId) => {
    chrome.runtime.sendMessage(
      {
        type: "TRACK_EVENT",
        payload: {
          user_id: userId,
          product_id: productId,
          event_type: eventType,
          duration_seconds: durationSeconds
        }
      },
      (response) => {
        console.log("Tracking response:", response);
      }
    );
  });
}
let startTime = Date.now();

window.addEventListener("beforeunload", () => {
  const durationSeconds = Math.floor((Date.now() - startTime) / 1000);

  console.log("Time spent:", durationSeconds);

  trackUserEvent(
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", // נחליף בהמשך לדינמי
    "view",
    durationSeconds
  );
});