/**
 * PolicyLens — extractor.js
 * -------------------------
 * Responsibility (per spec section 25): collect raw information from the
 * live DOM. This file does NOT know about policy categories/vocabulary —
 * that belongs to detector.js. It also does NOT dedupe or judge noise
 * beyond skipping truly non-content tags — that belongs to cleaner.js.
 *
 * Design notes:
 *  - Section 2/3: tags are treated as signals, not requirements. Traversal
 *    walks the whole tree rather than querying specific tag types.
 *  - Section 4: duplication is avoided using an "own text" heuristic — an
 *    element's text is only what it contributes directly (its own text
 *    nodes plus inline descendants like <span>/<b>/<a>-as-text). Block-level
 *    children are never double-counted because their text is not folded
 *    into the parent's own text.
 *  - Section 5/6: visibility is recorded, not used to discard content.
 *  - Section 8: interactive elements are only ever recorded as candidates.
 *    Nothing in this file clicks, submits, or otherwise activates anything.
 *  - Section 7: extractPage() is a pure function of the current DOM state
 *    and can be called again after the page changes (accordions, tabs,
 *    client-side rendering, etc.).
 */

const PolicyLensExtractor = (() => {
  // Tags whose subtree never contains human-readable policy text, or whose
  // content can't/shouldn't be read as text (scripts, styles, canvases...).
  const NOISE_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME']);

  // Inline elements are treated as part of the same textual unit as their
  // parent rather than as separate content blocks (section 4).
  const INLINE_TAGS = new Set([
    'SPAN', 'A', 'B', 'I', 'EM', 'STRONG', 'SMALL', 'MARK', 'ABBR',
    'SUP', 'SUB', 'LABEL', 'CODE', 'U'
  ]);

  const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
  const HEADING_CLASS_HINTS = ['title', 'heading', 'header', 'section-title', 'section-heading'];

  const INTERACTIVE_SELECTOR =
    'button, summary, [role="button"], [role="tab"], [role="menuitem"], a:not([href])';

  const LANDMARK_TAGS = new Set(['NAV', 'FOOTER', 'ASIDE', 'HEADER']);
  const LANDMARK_ROLES = new Set(['navigation', 'contentinfo', 'complementary', 'banner']);

  // ---------------------------------------------------------------------
  // Visibility analysis (section 5)
  // ---------------------------------------------------------------------

  function isElementOrAncestorHidden(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      let style;
      try {
        style = window.getComputedStyle(node);
      } catch (e) {
        node = node.parentElement;
        continue;
      }
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
        return true;
      }
      if (parseFloat(style.opacity) === 0) return true;
      if (node.hasAttribute('hidden')) return true;
      if (node.getAttribute('aria-hidden') === 'true') return true;
      node = node.parentElement;
    }
    return false;
  }

  function getVisibility(el) {
    if (isElementOrAncestorHidden(el)) return 'hidden';
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return 'hidden';
    return 'visible';
  }

  // ---------------------------------------------------------------------
  // Own-text extraction (section 4)
  // ---------------------------------------------------------------------

  function getOwnText(el) {
    let text = '';
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE && INLINE_TAGS.has(child.tagName)) {
        text += ' ' + getOwnText(child);
      }
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  function isMeaningfulText(text) {
    if (!text) return false;
    const trimmed = text.trim();
    if (trimmed.length < 15) return false;
    if (trimmed.split(/\s+/).length < 3) return false;
    return true;
  }

  // A container whose element children are all <a> tags, with nothing but
  // whitespace/separators between them, is a link list (nav menu, footer
  // link group) rather than a sentence. Without this check, merging each
  // anchor's text into the parent's "own text" (per the inline-merge rule
  // above) would fabricate meaningless fragments like "Return Policy
  // Warranty" that duplicate what collectLinks() already records properly.
  function isPureLinkContainer(el) {
    const children = Array.from(el.children);
    if (children.length === 0) return false;
    if (!children.every(c => c.tagName === 'A')) return false;

    let directText = '';
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) directText += child.textContent;
    }
    return directText.replace(/[\s|,•·–—-]+/g, '').trim().length === 0;
  }

  // ---------------------------------------------------------------------
  // Heading detection — semantic first, generic fallback (section 2/17)
  // ---------------------------------------------------------------------

  function isHeadingLikeGeneric(el) {
    if (HEADING_TAGS.has(el.tagName)) return false;
    const idClass = getIdClass(el);
    const classHintMatch = HEADING_CLASS_HINTS.some(hint => idClass.includes(hint));

    const text = getOwnText(el);
    if (!text) return false;
    const looksShort = text.length <= 60 && text.split(/\s+/).length <= 8;
    const endsLikeHeading = !/[.!?]$/.test(text);

    let styleSignal = false;
    try {
      const style = window.getComputedStyle(el);
      const fontWeight = parseInt(style.fontWeight, 10) || 400;
      const fontSize = parseFloat(style.fontSize) || 14;
      styleSignal = fontWeight >= 600 || fontSize >= 18;
    } catch (e) {
      // getComputedStyle can fail for detached/foreign nodes — ignore.
    }

    return (classHintMatch || styleSignal) && looksShort && endsLikeHeading;
  }

  // ---------------------------------------------------------------------
  // Helpers: id/class string, landmark ancestor, DOM path
  // ---------------------------------------------------------------------

  function getIdClass(el) {
    const cls = typeof el.className === 'string' ? el.className : '';
    return `${el.id || ''} ${cls}`.toLowerCase();
  }

  function getNearestLandmark(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
      if (LANDMARK_TAGS.has(node.tagName)) return node.tagName.toLowerCase();
      const role = node.getAttribute && node.getAttribute('role');
      if (role && LANDMARK_ROLES.has(role.toLowerCase())) return role.toLowerCase();
      node = node.parentElement;
    }
    return null;
  }

  // Builds a stable-ish selector path so a later controlled-interaction
  // step (section 8) or a re-extraction pass (section 7) can re-locate
  // this exact element without us needing to click anything now.
  function getDomPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      let selector = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`${selector}#${node.id}`);
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        if (siblings.length > 1) {
          selector += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
      }
      parts.unshift(selector);
      node = parent;
    }
    return parts.join(' > ');
  }

  // ---------------------------------------------------------------------
  // Heading order tracking, for "nearby heading" context (sections 12/13)
  // ---------------------------------------------------------------------

  function createHeadingTracker() {
    let lastHeadingText = null;
    return {
      setLast(text) { lastHeadingText = text; },
      getLast() { return lastHeadingText; }
    };
  }

  // ---------------------------------------------------------------------
  // Record builders
  // ---------------------------------------------------------------------

  function makeHeadingRecord(el, text) {
    return {
      type: 'heading',
      level: HEADING_TAGS.has(el.tagName) ? el.tagName.toLowerCase() : 'inferred',
      text,
      tag: el.tagName.toLowerCase(),
      visibility: getVisibility(el),
      domPath: getDomPath(el),
      idClass: getIdClass(el),
      landmark: getNearestLandmark(el)
    };
  }

  function makeBlockRecord(el, text, headingTracker) {
    return {
      type: 'text',
      text,
      tag: el.tagName.toLowerCase(),
      visibility: getVisibility(el),
      domPath: getDomPath(el),
      idClass: getIdClass(el),
      landmark: getNearestLandmark(el),
      context: {
        nearbyHeading: headingTracker.getLast()
      }
    };
  }

  function makeListRecord(el, headingTracker) {
    const items = Array.from(el.children)
      .filter(child => child.tagName === 'LI')
      .map(li => getOwnText(li) || li.textContent.replace(/\s+/g, ' ').trim())
      .filter(text => text.length > 0);

    return {
      type: 'list',
      items,
      tag: el.tagName.toLowerCase(),
      visibility: getVisibility(el),
      domPath: getDomPath(el),
      context: { nearbyHeading: headingTracker.getLast() }
    };
  }

  function makeTableRecord(el, headingTracker) {
    const rows = Array.from(el.querySelectorAll('tr')).map(tr =>
      Array.from(tr.children)
        .filter(cell => cell.tagName === 'TD' || cell.tagName === 'TH')
        .map(cell => cell.textContent.replace(/\s+/g, ' ').trim())
    );

    return {
      type: 'table',
      rows,
      visibility: getVisibility(el),
      domPath: getDomPath(el),
      context: { nearbyHeading: headingTracker.getLast() }
    };
  }

  // ---------------------------------------------------------------------
  // Main content traversal (sections 2, 3, 4, 18, 19)
  //
  // NOTE on scope: <ul>/<ol>/<table> are handled robustly via their
  // semantic structure. Non-semantic (div-based) lists/tables are NOT
  // specially reconstructed here — a div-per-row "fake table" will simply
  // fall through and be captured as ordinary text blocks. Extending this
  // to recognize repeated sibling structures as pseudo-lists/tables is a
  // reasonable follow-up but is intentionally left out of this pass to
  // keep the traversal logic auditable.
  // ---------------------------------------------------------------------

  function traverseForContent(el, results, headingTracker) {
    if (!el || el.nodeType !== 1) return;
    if (NOISE_TAGS.has(el.tagName)) return;

    if (HEADING_TAGS.has(el.tagName) || isHeadingLikeGeneric(el)) {
      const text = getOwnText(el);
      if (text) {
        const record = makeHeadingRecord(el, text);
        results.headings.push(record);
        headingTracker.setLast(record.text);
      }
      for (const child of el.children) {
        if (!INLINE_TAGS.has(child.tagName)) traverseForContent(child, results, headingTracker);
      }
      return;
    }

    if (el.tagName === 'UL' || el.tagName === 'OL') {
      const record = makeListRecord(el, headingTracker);
      if (record.items.length > 0) results.lists.push(record);
      return; // list items are not also emitted as separate text blocks
    }

    if (el.tagName === 'TABLE') {
      const record = makeTableRecord(el, headingTracker);
      if (record.rows.length > 0) results.tables.push(record);
      return; // table cells are not also emitted as separate text blocks
    }

    const ownText = getOwnText(el);
    if (isMeaningfulText(ownText) && !isPureLinkContainer(el)) {
      results.blocks.push(makeBlockRecord(el, ownText, headingTracker));
    }

    for (const child of el.children) {
      if (INLINE_TAGS.has(child.tagName)) continue; // already merged into ownText above
      traverseForContent(child, results, headingTracker);
    }
  }

  // ---------------------------------------------------------------------
  // Links (section 15) — collected independently of the content traversal
  // so a link's text being "used up" as part of a parent's own text never
  // prevents the link itself from being recorded.
  // ---------------------------------------------------------------------

  function collectLinks() {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    return anchors
      .map(a => ({
        text: (a.textContent || '').replace(/\s+/g, ' ').trim(),
        url: a.href,
        visibility: getVisibility(a),
        domPath: getDomPath(a),
        idClass: getIdClass(a),
        landmark: getNearestLandmark(a)
      }))
      .filter(link => link.text.length > 0 && link.url && !link.url.startsWith('javascript:'));
  }

  // ---------------------------------------------------------------------
  // Interactive elements (section 8/16) — recorded as candidates only.
  // Nothing here is ever clicked, submitted, or activated.
  // ---------------------------------------------------------------------

  function collectInteractiveElements() {
    const candidates = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
    return candidates
      .map(el => ({
        type: el.tagName.toLowerCase(),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
        visibility: getVisibility(el),
        domPath: getDomPath(el),
        idClass: getIdClass(el),
        landmark: getNearestLandmark(el)
      }))
      .filter(item => item.text.length > 0);
  }

  // ---------------------------------------------------------------------
  // Page metadata (section 22)
  // ---------------------------------------------------------------------

  function getPageMetadata() {
    const canonicalEl = document.querySelector('link[rel="canonical"]');
    const descriptionEl = document.querySelector('meta[name="description"]');
    return {
      url: window.location.href,
      domain: window.location.hostname,
      title: document.title || '',
      canonicalUrl: canonicalEl ? canonicalEl.href : null,
      metaDescription: descriptionEl ? descriptionEl.getAttribute('content') : null
    };
  }

  // ---------------------------------------------------------------------
  // Public entry point — pure function of current DOM state (section 7)
  // ---------------------------------------------------------------------

  function extractPage() {
    const headingTracker = createHeadingTracker();
    const results = { blocks: [], headings: [], lists: [], tables: [] };

    traverseForContent(document.body, results, headingTracker);

    return {
      page: getPageMetadata(),
      content: results,
      links: collectLinks(),
      interactiveElements: collectInteractiveElements(),
      extractedAt: new Date().toISOString()
    };
  }

  return { extractPage, getVisibility, getDomPath };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PolicyLensExtractor;
}
if (typeof window !== 'undefined') {
  window.PolicyLensExtractor = PolicyLensExtractor;
}