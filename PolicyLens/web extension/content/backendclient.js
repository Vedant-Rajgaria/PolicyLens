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
  // Placeholder — intentionally not a real, reachable endpoint yet.
  const BACKEND_ENDPOINT = 'https://api.policylens.example/v1/analyze';

  /**
   * Sends the extraction payload (the same {success, data, stats} shape
   * popup.js already renders from) to the backend.
   *
   * Never throws — callers can fire-and-forget this without try/catch.
   * Returns { sent: true } on a successful POST, or { sent: false, ... }
   * on any failure (network error, non-2xx response, endpoint not yet
   * configured).
   */
  async function sendAnalysis(payload) {
    try {
      const response = await fetch(BACKEND_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        console.warn('[PolicyLens] Backend responded with status', response.status);
        return { sent: false, status: response.status };
      }

      return { sent: true, status: response.status };
    } catch (error) {
      // Expected for now — connectivity isn't configured yet. Log a
      // short status line only; never log `payload` here, since that
      // would just reintroduce the console dump this module replaces.
      console.warn('[PolicyLens] Backend not reachable (connectivity not yet configured):', error.message);
      return { sent: false, error: error.message };
    }
  }

  return { sendAnalysis, BACKEND_ENDPOINT };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PolicyLensBackend;
}
if (typeof window !== 'undefined') {
  window.PolicyLensBackend = PolicyLensBackend;
}