/**
 * PolicyLens — Policy Vocabulary Configuration
 * ---------------------------------------------
 * Per spec section 11: vocabulary is kept separate from traversal/detection
 * logic so categories and terms can be expanded later without touching
 * algorithm code in extractor.js / cleaner.js / detector.js.
 *
 * Each category has:
 *   - terms:      phrases looked for in heading text and body text
 *   - urlHints:   substrings looked for in the page URL / link URL
 *   - classHints: substrings looked for in element id/class attributes
 */

const POLICY_VOCABULARY = {
  RETURN: {
    terms: [
      'return', 'returns', 'return policy', 'return window', 'return period',
      'eligible for return', 'returning an item', 'return shipping',
      'return label', 'restocking fee'
    ],
    urlHints: ['return', 'returns'],
    classHints: ['return']
  },
  REFUND: {
    terms: [
      'refund', 'refunds', 'refund policy', 'money back', 'money-back',
      'reimbursement', 'credited back', 'refunded to your original payment'
    ],
    urlHints: ['refund'],
    classHints: ['refund']
  },
  WARRANTY: {
    terms: [
      'warranty', 'guarantee', 'coverage', 'manufacturing defect',
      'repair', 'replacement', 'limited warranty', 'extended warranty'
    ],
    urlHints: ['warranty', 'guarantee'],
    classHints: ['warranty']
  },
  CANCELLATION: {
    terms: [
      'cancellation', 'cancel', 'cancel anytime', 'cancellation policy',
      'cancellation fee', 'early termination'
    ],
    urlHints: ['cancel', 'cancellation'],
    classHints: ['cancel']
  },
  EXCHANGE: {
    terms: ['exchange', 'exchange policy', 'size exchange', 'product exchange'],
    urlHints: ['exchange'],
    classHints: ['exchange']
  },
  SHIPPING: {
    terms: [
      'shipping', 'shipping policy', 'shipping cost', 'shipping fee',
      'free shipping', 'shipping time', 'handling time'
    ],
    urlHints: ['shipping'],
    classHints: ['shipping']
  },
  DELIVERY: {
    terms: [
      'delivery', 'delivery time', 'estimated delivery', 'delivery date',
      'delivery policy', 'arrives by'
    ],
    urlHints: ['delivery'],
    classHints: ['delivery']
  },
  PAYMENT: {
    terms: [
      'payment', 'payment method', 'payment terms', 'billing',
      'installment', 'auto-charge', 'auto charge'
    ],
    urlHints: ['payment', 'billing'],
    classHints: ['payment', 'billing']
  },
  SUBSCRIPTION: {
    terms: [
      'subscription', 'subscribe', 'recurring', 'auto-renew', 'auto renew',
      'renewal', 'membership fee', 'billing cycle'
    ],
    urlHints: ['subscription', 'membership'],
    classHints: ['subscription', 'membership']
  },
  PRIVACY: {
    terms: [
      'privacy', 'privacy policy', 'personal data', 'personal information',
      'data collection', 'cookies policy', 'third parties'
    ],
    urlHints: ['privacy'],
    classHints: ['privacy']
  },
  TERMS: {
    terms: [
      'terms', 'terms and conditions', 'terms of service', 'terms of use',
      'agreement', 'legal'
    ],
    urlHints: ['terms', 'tos', 'legal'],
    classHints: ['terms', 'legal']
  }
};

/**
 * Per spec section 14: sentences containing these indicators frequently
 * carry conditions/restrictions ("only if unused", "non-refundable", etc.)
 * and should be treated as higher-relevance, preserved in full rather than
 * summarized.
 */
const CONDITION_INDICATORS = [
  'only', 'unless', 'except', 'provided that', 'must', 'required',
  'not eligible', 'excluded', 'non-refundable', 'non-returnable',
  'subject to', 'within', 'before', 'after'
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { POLICY_VOCABULARY, CONDITION_INDICATORS };
}
if (typeof window !== 'undefined') {
  window.POLICY_VOCABULARY = POLICY_VOCABULARY;
  window.CONDITION_INDICATORS = CONDITION_INDICATORS;
}