/**
 * PolicyLens — detector.js
 * ------------------------
 * Responsibility (per spec section 25): identify policy relevance and
 * categorize content. This is the ONLY file that knows about policy
 * vocabulary/categories — extractor.js and cleaner.js stay generic.
 *
 * Explicitly out of scope here (section 24): whether a policy is fair,
 * legally valid, trustworthy, or risky. This file only answers "how
 * strongly does this content relate to category X, and does it contain a
 * condition/restriction worth flagging" — never "is that condition okay".
 *
 * Requires POLICY_VOCABULARY / CONDITION_INDICATORS from policyVocabulary.js
 * to be loaded first (either via <script> order or require()).
 */

const PolicyLensDetector = (() => {
  const vocab = typeof POLICY_VOCABULARY !== 'undefined'
    ? POLICY_VOCABULARY
    : (typeof require === 'function' ? require('./policyVocabulary').POLICY_VOCABULARY : {});
  const conditionIndicators = typeof CONDITION_INDICATORS !== 'undefined'
    ? CONDITION_INDICATORS
    : (typeof require === 'function' ? require('./policyVocabulary').CONDITION_INDICATORS : []);

  // Signal weights — text match in a heading counts more than the same
  // match in body text; URL/class hints add supporting (not primary)
  // weight (section 10).
  const WEIGHTS = { bodyTerm: 2, headingTerm: 3, urlHint: 2, classHint: 1.5, condition: 1.5 };

  // "Strongly confident" ceiling used to squash raw signal scores into a
  // 0–1 confidence range. Tunable — a higher ceiling makes the detector
  // more conservative about calling something high-confidence.
  const CONFIDENCE_CEILING = 8;
  const MIN_SECTION_CONFIDENCE = 0.35;
  const NOISE_PENALTY_FACTOR = 0.3;
  // A single incidental body-text mention of a vocabulary term (e.g. a
  // sentence using the word "return" in passing) is the main remaining
  // source of false positives once obvious noise regions are excluded.
  // Require either repeated body evidence or corroboration from a
  // heading/URL/class-name hint before body-term score counts at all.
  const MIN_BODY_HITS_WITHOUT_CORROBORATION = 2;

  function hasConditionIndicator(text) {
    const lower = (text || '').toLowerCase();
    return conditionIndicators.some(term => lower.includes(term));
  }

  // Cap on how many distinct body-text term hits count toward a single
  // category's score. A paragraph naming a category's vocabulary three or
  // more times is already maximally strong evidence; counting a tenth
  // repeated mention wouldn't make it more true, just more sensitive to
  // filler/keyword-stuffed pages.
  const MAX_BODY_TERM_HITS = 3;

  // Multi-signal scoring (section 10): combines heading text, body text,
  // URL, and class/id — no single keyword hit decides the category.
  //
  // Heading/URL/class hints are scored as PRESENCE (does this category
  // show up here at all?), not summed per matching term. Vocabulary terms
  // for one category often overlap as substrings of each other (e.g.
  // "return" and "return policy" both match a heading literally reading
  // "Return Policy"), and summing every match would let a short heading
  // outweigh real signal from the body text of an unrelated category.
  // Body text is summed (and capped) instead, since a longer passage
  // genuinely can carry cumulative evidence for a category.
  function scoreAgainstVocabulary({ bodyText = '', headingText = '', url = '', idClass = '' }) {
    const lowerBody = bodyText.toLowerCase();
    const lowerHeading = headingText.toLowerCase();
    const lowerUrl = url.toLowerCase();
    const lowerIdClass = idClass.toLowerCase();

    const scores = {};
    for (const [category, def] of Object.entries(vocab)) {
      let score = 0;

      const bodyHits = def.terms.reduce((count, term) => count + (lowerBody.includes(term) ? 1 : 0), 0);
      const headingMatch = def.terms.some(term => lowerHeading.includes(term));
      const urlMatch = def.urlHints.some(hint => lowerUrl.includes(hint));
      const classMatch = def.classHints.some(hint => lowerIdClass.includes(hint));
      const hasCorroboration = headingMatch || urlMatch || classMatch;

      // A lone body mention with no other signal is exactly the pattern
      // that produced "CHECK" cards off casual/incidental keyword use
      // (a review saying "I had to return it..."). Only count body
      // evidence once it's either repeated or backed by another signal.
      if (bodyHits > 0 && (hasCorroboration || bodyHits >= MIN_BODY_HITS_WITHOUT_CORROBORATION)) {
        score += Math.min(bodyHits, MAX_BODY_TERM_HITS) * WEIGHTS.bodyTerm;
      }

      if (headingMatch) score += WEIGHTS.headingTerm;
      if (urlMatch) score += WEIGHTS.urlHint;
      if (classMatch) score += WEIGHTS.classHint;

      if (score > 0) scores[category] = score;
    }
    return scores;
  }

  function pickBestCategory(scores) {
    let best = null;
    let bestScore = 0;
    for (const [category, score] of Object.entries(scores)) {
      if (score > bestScore) {
        best = category;
        bestScore = score;
      }
    }
    return { category: best, rawScore: bestScore };
  }

  function toConfidence(rawScore) {
    return Math.max(0, Math.min(1, rawScore / CONFIDENCE_CEILING));
  }

  function applyNoisePenalty(rawScore, item) {
    return item.likelyNoise ? rawScore * NOISE_PENALTY_FACTOR : rawScore;
  }

  // -----------------------------------------------------------------
  // Blocks → policy sections (sections 10–14)
  // -----------------------------------------------------------------

  function classifyBlocks(blocks, pageContext) {
    return blocks.map(block => {
      const scores = scoreAgainstVocabulary({
        bodyText: block.text,
        headingText: (block.context && block.context.nearbyHeading) || '',
        url: pageContext.url,
        idClass: block.idClass
      });
      let { category, rawScore } = pickBestCategory(scores);
      rawScore = applyNoisePenalty(rawScore, block);

      const condition = hasConditionIndicator(block.text);
      if (condition) rawScore += WEIGHTS.condition;

      return { ...block, category, confidence: toConfidence(rawScore), hasCondition: condition };
    });
  }

  // Ceiling on how many statements a single category card shows. The
  // detector can legitimately find a dozen+ matching blocks on a long
  // page; showing all of them turns a "here's what you need to know"
  // card back into the wall of text this tool exists to avoid.
  const MAX_BLOCKS_PER_SECTION = 6;

  function buildPolicySections(classifiedBlocks) {
    const grouped = {};
    for (const block of classifiedBlocks) {
      if (!block.category || block.confidence < MIN_SECTION_CONFIDENCE) continue;
      if (!grouped[block.category]) {
        grouped[block.category] = { category: block.category, entries: [] };
      }
      // Preserve the complete statement rather than reducing it to a
      // fragment (section 13) — especially important when hasCondition is
      // true (section 14).
      grouped[block.category].entries.push({
        text: block.text,
        confidence: block.confidence,
        hasCondition: block.hasCondition
      });
    }

    return Object.values(grouped).map(group => {
      // Strongest and/or condition-bearing statements first, then cap —
      // conditions (non-refundable, within X days, etc.) are the highest-
      // value lines for a user deciding whether to buy, so they're never
      // the ones trimmed off.
      const ranked = group.entries
        .slice()
        .sort((a, b) => (b.hasCondition - a.hasCondition) || (b.confidence - a.confidence));
      const kept = ranked.slice(0, MAX_BLOCKS_PER_SECTION);
      const omitted = ranked.length - kept.length;

      return {
        category: group.category,
        confidence: Number((group.entries.reduce((sum, e) => sum + e.confidence, 0) / group.entries.length).toFixed(2)),
        blocks: kept.map(e => e.text),
        omittedCount: omitted > 0 ? omitted : 0
      };
    }).sort((a, b) => b.confidence - a.confidence);
  }

  // -----------------------------------------------------------------
  // Links (section 15)
  // -----------------------------------------------------------------

  function scoreLink(link, pageContext) {
    const scores = scoreAgainstVocabulary({
      bodyText: link.text,
      headingText: '',
      url: link.url || pageContext.url,
      idClass: link.idClass
    });
    const { rawScore } = pickBestCategory(scores);
    return applyNoisePenalty(rawScore, link);
  }

  function rankLinks(links, pageContext, limit = 12) {
    return links
      .map(link => ({ ...link, relevanceScore: scoreLink(link, pageContext) }))
      .filter(link => link.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit)
      .map(({ idClass, landmark, likelyNoise, relevanceScore, ...rest }) => ({
        ...rest,
        relevanceScore: Number(relevanceScore.toFixed(2))
      }));
  }

  // -----------------------------------------------------------------
  // Interactive elements (sections 8/16) — categorized, never activated
  // -----------------------------------------------------------------

  function categorizeInteractiveElements(items, pageContext) {
    return items
      .map(item => {
        const scores = scoreAgainstVocabulary({
          bodyText: item.text,
          headingText: '',
          url: pageContext.url,
          idClass: item.idClass
        });
        const { category, rawScore } = pickBestCategory(scores);
        return { ...item, category, relevanceScore: applyNoisePenalty(rawScore, item) };
      })
      .filter(item => item.category && item.relevanceScore > 0)
      .map(({ idClass, landmark, likelyNoise, relevanceScore, ...rest }) => rest);
  }

  // -----------------------------------------------------------------
  // Public entry point
  // -----------------------------------------------------------------

  function detect(cleaned) {
    const classifiedBlocks = classifyBlocks(cleaned.content.blocks, cleaned.page);
    const policySections = buildPolicySections(classifiedBlocks);

    // content.blocks keeps the plain shape from spec section 23
    // (type/text/tag/visibility/context) — per-block category/confidence
    // detail lives in policySections instead, so an ambiguous block isn't
    // forced into exactly one bucket.
    const blocks = cleaned.content.blocks.map(({ idClass, landmark, likelyNoise, ...rest }) => rest);
    const headings = cleaned.content.headings.map(({ idClass, landmark, ...rest }) => rest);

    const links = rankLinks(cleaned.links, cleaned.page);
    const interactiveElements = categorizeInteractiveElements(cleaned.interactiveElements, cleaned.page);

    return {
      page: cleaned.page,
      content: {
        blocks,
        headings,
        lists: cleaned.content.lists,
        tables: cleaned.content.tables
      },
      policySections,
      links,
      interactiveElements
    };
  }

  return { detect, scoreAgainstVocabulary, hasConditionIndicator };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PolicyLensDetector;
}
if (typeof window !== 'undefined') {
  window.PolicyLensDetector = PolicyLensDetector;
}