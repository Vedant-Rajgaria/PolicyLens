/**
 * PolicyLens — siteAdapters.js
 * ----------------------------
 * Hackathon optimization pass: the generic pipeline (extractor → cleaner →
 * detector) treats the whole page as fair game, which on a real Amazon or
 * Flipkart product page means thousands of text blocks — reviews,
 * "customers also bought" carousels, nav megamenus, footers — most of
 * which are NOT policy content but casually contain policy *words*
 * ("I had to return this...", "free shipping to reviewers", etc). That's
 * the main source of the noisy/irrelevant results.
 *
 * This module does two narrow things for recognized sites, and changes
 * NOTHING for any other domain (generic behavior is untouched):
 *
 *  1. SCOPE   — picks a root element to traverse from (the product detail
 *               area) instead of document.body.
 *  2. EXCLUDE — marks known non-policy regions (reviews, recommendation
 *               rails, nav/footer chrome) so the extractor skips them
 *               entirely, rather than merely down-weighting them.
 *
 * Selectors are intentionally redundant/defensive: e-commerce markup
 * changes often and hashed class names (Flipkart especially) are
 * unstable, so every list has multiple fallback candidates and the whole
 * module fails open — if nothing matches, extraction just falls back to
 * the full page rather than returning nothing.
 */

const PolicyLensSiteAdapter = (() => {
  function detectSite(hostname) {
    const h = (hostname || '').toLowerCase();
    if (h.includes('amazon.')) return 'amazon';
    if (h.includes('flipkart.')) return 'flipkart';
    return 'generic';
  }

  // Candidate containers for "the product page itself". First match wins.
  const SCOPE_SELECTORS = {
    amazon: [
      '#dp-container',
      '#ppd',
      '#centerCol',
      '#dpx-container',
      '#productDetails_feature_div'
    ],
    flipkart: [
      'div[data-testid="pdp"]',
      'div._1YokD2',
      'div._2kHMtA',
      'main',
      '#container'
    ]
  };

  // Regions that are almost never policy prose — reviews, ratings widgets,
  // recommendation/similar-product rails. Excluded for BOTH content blocks
  // and links/interactive elements, since a review's "read more" button or
  // a carousel's product links are equally irrelevant to policy info.
  const EXCLUDE_SELECTORS_NARROW = {
    amazon: [
      '#reviewsMedley',
      '#cr-summarization-attributes-list',
      '[data-hook="reviews-medley-widget"]',
      '[id*="cr-"]',
      '#similarities_feature_div',
      '#sims-consolidated-1_feature_div',
      '#sp_detail',
      '#hero-quick-promo', '#anonCarousel1', '#anonCarousel2',
      '[data-hook="recommendations"]'
    ],
    flipkart: [
      '[class*="review" i]',
      '[class*="rating" i]',
      '[class*="carousel" i]',
      '[class*="similar" i]',
      '[class*="recommend" i]'
    ]
  };

  // Additionally excluded for CONTENT BLOCKS (prose) only — nav/footer
  // chrome. NOT applied to links or interactive elements, because the
  // footer/nav is exactly where the real "Return Policy" / "Terms of Use" /
  // "Privacy Policy" links usually live; dropping those would remove the
  // most authoritative links this tool can surface.
  const EXCLUDE_SELECTORS_CONTENT_ONLY = {
    amazon: ['#navbar', '#nav-belt', '#navFooter', '#rhf'],
    flipkart: ['footer', 'header']
  };

  function mergeSelectors(site) {
    return {
      narrow: EXCLUDE_SELECTORS_NARROW[site] || [],
      content: (EXCLUDE_SELECTORS_NARROW[site] || []).concat(EXCLUDE_SELECTORS_CONTENT_ONLY[site] || [])
    };
  }

  function safeQueryAll(root, selector) {
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch (e) {
      // Unsupported/invalid selector on this page (e.g. :has fallback) —
      // skip it rather than throwing and killing the whole extraction.
      return [];
    }
  }

  function resolveScopeRoot(site) {
    const candidates = SCOPE_SELECTORS[site] || [];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return document.body;
  }

  function buildExcludedSet(selectors, scanRoot) {
    const excluded = new Set();
    for (const sel of selectors) {
      safeQueryAll(scanRoot, sel).forEach(el => excluded.add(el));
    }
    return excluded;
  }

  function isWithinExcluded(el, excludedSet) {
    let node = el;
    while (node) {
      if (excludedSet.has(node)) return true;
      node = node.parentElement;
    }
    return false;
  }

  // Public entry point: figure out which site we're on, and hand back:
  //  - root: element to traverse for prose content
  //  - isContentExcluded: skip predicate for prose traversal (broad)
  //  - isLinkExcluded: skip predicate for links/interactive elements
  //    (narrow — deliberately keeps nav/footer so real policy links survive)
  function getContext() {
    const hostname = (typeof window !== 'undefined' && window.location) ? window.location.hostname : '';
    const site = detectSite(hostname);

    if (site === 'generic') {
      return {
        site,
        root: document.body,
        isContentExcluded: () => false,
        isLinkExcluded: () => false
      };
    }

    const root = resolveScopeRoot(site);
    const selectors = mergeSelectors(site);
    // Narrow (reviews/carousels) exclusions are checked document-wide since
    // review widgets can sit outside the content root on some layouts.
    const linkExcludedSet = buildExcludedSet(selectors.narrow, document.body);
    const contentExcludedSet = buildExcludedSet(selectors.content, document.body);

    return {
      site,
      root,
      isContentExcluded: (el) => isWithinExcluded(el, contentExcludedSet),
      isLinkExcluded: (el) => isWithinExcluded(el, linkExcludedSet)
    };
  }

  return { detectSite, getContext };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PolicyLensSiteAdapter;
}
if (typeof window !== 'undefined') {
  window.PolicyLensSiteAdapter = PolicyLensSiteAdapter;
}
