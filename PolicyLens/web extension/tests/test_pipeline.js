const cleaner = require('./cleaner.js');
const detector = require('./detector.js');

// Simulate raw extraction output for a fake Amazon-like product page,
// mixing real policy text with review/carousel noise that should now be
// suppressed.
const raw = {
  page: { url: 'https://www.amazon.in/dp/B000TEST', domain: 'amazon.in', title: 'Test Product', site: 'amazon' },
  content: {
    blocks: [
      { type: 'text', text: '10 days Return and exchange available. Non-refundable if the item is used or damaged.', tag: 'p', visibility: 'visible', idClass: 'a-section', landmark: null, context: { nearbyHeading: 'Return & Warranty' } },
      { type: 'text', text: 'This is a great product, I had to return it once but the replacement worked fine.', tag: 'p', visibility: 'visible', idClass: 'review-text', landmark: null, context: { nearbyHeading: null } },
      { type: 'text', text: '1 year manufacturer warranty from the date of purchase, covering manufacturing defects only.', tag: 'p', visibility: 'visible', idClass: 'a-section warranty', landmark: null, context: { nearbyHeading: 'Warranty' } },
      { type: 'text', text: 'Free delivery within 3-5 business days across most pin codes in India.', tag: 'p', visibility: 'visible', idClass: 'delivery-block', landmark: null, context: { nearbyHeading: 'Delivery' } },
      { type: 'text', text: 'Customers who bought this also bought a phone case and a return of great value.', tag: 'p', visibility: 'visible', idClass: 'similar-product-widget', landmark: null, context: { nearbyHeading: null } },
      { type: 'text', text: 'Cash on delivery is not available for this item, prepaid payment only.', tag: 'p', visibility: 'visible', idClass: 'payment-info', landmark: null, context: { nearbyHeading: 'Payment' } }
    ],
    headings: [ { text: 'Return & Warranty', tag: 'h3', visibility: 'visible', idClass: '', landmark: null } ],
    lists: [],
    tables: []
  },
  links: [
    { text: 'Return Policy', url: 'https://www.amazon.in/gp/help/customer/display.html?nodeId=return-policy', visibility: 'visible', idClass: '', landmark: 'footer' },
    { text: 'View similar products', url: 'https://www.amazon.in/similar/xyz', visibility: 'visible', idClass: 'similar-product-link', landmark: null }
  ],
  interactiveElements: []
};

const cleaned = cleaner.clean(raw);
console.log('--- cleaned block count ---', cleaned.content.blocks.length);
cleaned.content.blocks.forEach(b => console.log(' kept:', b.text.slice(0,60), '| likelyNoise:', b.likelyNoise));

const detected = detector.detect(cleaned);
console.log('\n--- policySections ---');
console.log(JSON.stringify(detected.policySections, null, 2));

console.log('\n--- links ---');
console.log(JSON.stringify(detected.links, null, 2));
