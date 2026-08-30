/**
 * PolicyLens — cleaner.js
 * -----------------------
 * Responsibility (per spec section 25): normalize text/URLs, remove
 * duplicate content (section 20), and flag likely noise (section 21).
 *
 * Design note on noise removal: obvious non-content categories (cookie
 * banners, ads, social widgets, tracking, recommendation carousels) are
 * dropped outright, since they are essentially never policy-relevant.
 * Primary <nav> content is *flagged* (likelyNoise = true) rather than
 * deleted — spec section 21 explicitly warns that generic containers can
 * hold the most important policy content on a page, so a borderline case
 * is down-ranked in detector.js's scoring instead of being silently
 * discarded here.
 */

const PolicyLensCleaner = (() => {
  const HARD_NOISE_CLASS_HINTS = [
    'cookie', 'gdpr', 'consent', 'advert', 'sponsor', 'social-share',
    'recommendation', 'related-product', 'tracking-pixel', 'analytics',
    'newsletter-popup', 'chat-widget',
    // E-commerce engagement rails: near-universal noise for a policy
    // extractor since they're UGC/upsell text, not the seller's own
    // policy statements, even when they happen to mention "return" etc.
    'review', 'rating', 'carousel', 'similar-product', 'also-bought',
    'also-viewed', 'you-may-like', 'cross-sell', 'upsell', 'breadcrumb'
  ];

  function normalizeText(text) {
    return (text || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[.,;:!?'"“”‘’]+$/g, '')
      .trim();
  }

  function normalizeUrl(url) {
    try {
      const parsed = new URL(url, typeof window !== 'undefined' ? window.location.href : undefined);
      parsed.hash = '';
      let out = parsed.toString();
      if (out.endsWith('/')) out = out.slice(0, -1);
      return out.toLowerCase();
    } catch (e) {
      return (url || '').trim().toLowerCase();
    }
  }

  function matchesHardNoiseClass(idClass) {
    if (!idClass) return false;
    return HARD_NOISE_CLASS_HINTS.some(hint => idClass.includes(hint));
  }

  function isNavLandmark(landmark) {
    return landmark === 'nav' || landmark === 'navigation';
  }

  function annotateNoise(item) {
    return {
      ...item,
      likelyNoise: Boolean(matchesHardNoiseClass(item.idClass) || isNavLandmark(item.landmark))
    };
  }

  function isHardNoise(item) {
    return matchesHardNoiseClass(item.idClass);
  }

  // -----------------------------------------------------------------
  // Deduplication (section 20)
  // -----------------------------------------------------------------

  function dedupeBlocks(blocks) {
    const seen = new Map();
    for (const block of blocks) {
      const key = normalizeText(block.text);
      if (!key) continue;
      const existing = seen.get(key);
      if (!existing || (existing.visibility === 'hidden' && block.visibility === 'visible')) {
        seen.set(key, block);
      }
    }
    return Array.from(seen.values());
  }

  function dedupeHeadings(headings) {
    const seen = new Set();
    return headings.filter(h => {
      const key = normalizeText(h.text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function dedupeLists(lists) {
    const seen = new Set();
    return lists.filter(list => {
      const key = list.items.map(normalizeText).join('|');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function dedupeTables(tables) {
    const seen = new Set();
    return tables.filter(table => {
      const key = table.rows.map(row => row.map(normalizeText).join(',')).join(';');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function dedupeLinks(links) {
    const seen = new Map();
    for (const link of links) {
      const key = normalizeUrl(link.url);
      if (!key) continue;
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, link);
        continue;
      }
      const shouldReplace =
        (existing.visibility === 'hidden' && link.visibility === 'visible') ||
        (link.visibility === 'visible' && link.text.length > existing.text.length);
      if (shouldReplace) seen.set(key, link);
    }
    return Array.from(seen.values());
  }

  function dedupeInteractiveElements(items) {
    const seen = new Map();
    for (const item of items) {
      const key = `${item.type}::${normalizeText(item.text)}`;
      const existing = seen.get(key);
      if (!existing || (existing.visibility === 'hidden' && item.visibility === 'visible')) {
        seen.set(key, item);
      }
    }
    return Array.from(seen.values());
  }

  // -----------------------------------------------------------------
  // Public entry point
  // -----------------------------------------------------------------

  function clean(raw) {
    const blocks = dedupeBlocks(raw.content.blocks)
      .map(annotateNoise)
      .filter(b => !isHardNoise(b));

    const links = dedupeLinks(raw.links)
      .map(annotateNoise)
      .filter(l => !isHardNoise(l));

    const interactiveElements = dedupeInteractiveElements(raw.interactiveElements)
      .map(annotateNoise)
      .filter(i => !isHardNoise(i));

    return {
      page: raw.page,
      content: {
        blocks,
        headings: dedupeHeadings(raw.content.headings),
        lists: dedupeLists(raw.content.lists),
        tables: dedupeTables(raw.content.tables)
      },
      links,
      interactiveElements
    };
  }

  return { clean, normalizeText, normalizeUrl };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PolicyLensCleaner;
}
if (typeof window !== 'undefined') {
  window.PolicyLensCleaner = PolicyLensCleaner;
}