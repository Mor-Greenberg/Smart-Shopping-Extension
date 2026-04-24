chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "TRACK_EVENT") return;

  fetch("http://localhost:3000/event", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(message.payload)
  })
    .then(res => res.text())
    .then(data => {
      console.log("Event saved:", data);
      sendResponse({ ok: true, data });
    })
    .catch(error => {
      console.error("Background tracking error:", error);
      sendResponse({ ok: false, error: error.message });
    });

  return true;
});