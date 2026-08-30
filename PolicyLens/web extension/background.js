const BACKEND_ENDPOINT = "http://localhost:8000/analyze";

console.log("[PolicyLens BG] background.js loaded");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "POLICYLENS_ANALYZE") return;
  fetch(BACKEND_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message.payload)
  })
    .then(async (res) => {
      if (!res.ok) {
        sendResponse({ ok: false, status: res.status, error: await res.text().catch(() => res.statusText) });
        return;
      }
      sendResponse({ ok: true, data: await res.json() });
    })
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true; // keeps the async channel open
});