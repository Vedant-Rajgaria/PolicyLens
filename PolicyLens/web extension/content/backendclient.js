/**
 * PolicyLens — backendClient.js
 * ------------------------------
 * Responsibility: hand the extracted + processed page data off to the
 * PolicyLens backend (the validator/classifier/checklist/optimizer/
 * analyser pipeline in app/processing) instead of dumping it to the
 * console.
 *
 * Connectivity is NOT set up yet — there is no live backend URL to point
 * at. This module is a stub so the rest of the extension (index.js,
 * popup.js) can be wired to "send to backend" now, with only this one
 * file needing to change once a real endpoint exists:
 *
 *   1. Replace BACKEND_ENDPOINT below with the real URL.
 *   2. Add that origin to "host_permissions" in manifest.json.
 *   3. Content scripts making cross-origin fetches can run into CORS/CSP
 *      restrictions from the host page in Manifest V3 — if that happens,
 *      route sendAnalysis() through a background service worker via
 *      chrome.runtime.sendMessage instead of calling fetch directly here.
 *
 * Until then, sendAnalysis() fails closed: network errors are caught and
 * reported as a short status message, never by re-printing the payload.
 */

const PolicyLensBackend = (() => {
  async function sendAnalysis(payload) {
    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "POLICYLENS_ANALYZE", payload }, (result) => {
          if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
          resolve(result);
        });
      });
      if (!response || !response.ok) return { sent: false, error: response?.error };
      return { sent: true, data: response.data };
    } catch (error) {
      console.warn('[PolicyLens] Backend not reachable:', error.message);
      return { sent: false, error: error.message };
    }
  }
  return { sendAnalysis };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PolicyLensBackend;
if (typeof window !== 'undefined') window.PolicyLensBackend = PolicyLensBackend;