chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FIND_OR_CREATE_PRODUCT") {
    fetch("http://localhost:3000/products/find-or-create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(message.payload)
    })
      .then(res => res.json())
      .then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message.type === "TRACK_EVENT") {
    fetch("http://localhost:3000/event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(message.payload)
    })
      .then(res => res.text())
      .then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: error.message }));

    return true;
  }
});