/**
 * PolicyLens — index.js
 * ---------------------
 * Orchestrates extractor.js → cleaner.js → detector.js (section 25), then
 * flattens the structured result into a flat LIST of typed records before
 * sending it to the Python backend.
 *
 * Why flatten here (and not in detector.js): the "shape used internally"
 * (a nested, structured object — easy to reason about and test) is kept
 * separate from the "shape used on the wire" (a flat list of tagged
 * records — what the backend expects). Either can change independently.
 */

const PolicyLens = (() => {
  function runExtraction() {
    const raw = PolicyLensExtractor.extractPage();
    const cleaned = PolicyLensCleaner.clean(raw);
    return PolicyLensDetector.detect(cleaned);
  }

  function toBackendList(structured) {
    const list = [];

    list.push({ recordType: 'page', ...structured.page });

    for (const heading of structured.content.headings) {
      list.push({ recordType: 'heading', ...heading });
    }
    for (const block of structured.content.blocks) {
      list.push({ recordType: 'block', ...block });
    }
    for (const listItem of structured.content.lists) {
      list.push({ recordType: 'list', ...listItem });
    }
    for (const table of structured.content.tables) {
      list.push({ recordType: 'table', ...table });
    }
    for (const section of structured.policySections) {
      list.push({ recordType: 'policySection', ...section });
    }
    for (const link of structured.links) {
      list.push({ recordType: 'link', ...link });
    }
    for (const interactiveElement of structured.interactiveElements) {
      list.push({ recordType: 'interactiveElement', ...interactiveElement });
    }

    return list;
  }

  async function sendToBackend(list, endpoint) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: list, sentAt: new Date().toISOString() })
      });
      if (!response.ok) {
        throw new Error(`Backend responded with status ${response.status}`);
      }
      return await response.json();
    } catch (err) {
      console.error('[PolicyLens] Failed to send extraction to backend:', err);
      return null;
    }
  }

  /**
   * Public entry point. Safe to call again later (section 7) — e.g. after
   * the user expands an accordion, after a tab switch, or after the
   * backend reports missing information and the page state has changed.
   * Each call re-reads the live DOM from scratch; nothing is cached.
   */
  async function extractAndSend(endpoint) {
    const structured = runExtraction();
    const list = toBackendList(structured);
    const response = await sendToBackend(list, endpoint);
    return { list, response };
  }

  return { runExtraction, toBackendList, sendToBackend, extractAndSend };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PolicyLens;
}
if (typeof window !== 'undefined') {
  window.PolicyLens = PolicyLens;
}
console.log("[PolicyLens] Content pipeline loaded successfully!");
console.log("[PolicyLens] PolicyLens object:", PolicyLens);//to be removed in production