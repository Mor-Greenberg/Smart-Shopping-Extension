/**
 * Predefined product pages used by the manual selector health check.
 * Update a URL here if a probe 404s — the check visits these pages and
 * verifies Price + Title CSS selectors from config.js still return data.
 */
module.exports = [
    {
        siteKey: 'shop.super-pharm.co.il',
        url: 'https://shop.super-pharm.co.il/p/705084',
        titleSelectors: ['h1', '.product-name', 'meta[property="og:title"]']
    },
    {
        siteKey: '365mashbir.co.il',
        url: 'https://365mashbir.co.il/products/קופסת-אוכל-9-1ליטר-פתיחה-כפולה',
        titleSelectors: ['h1', '.product-title', '.product-name', 'meta[property="og:title"]']
    },
    {
        siteKey: 'www.shufersal.co.il',
        url: 'https://www.shufersal.co.il/online/he/search?text=20714157760',
        titleSelectors: ['h1', '.miglog-prod-name', '.productName', 'meta[property="og:title"]']
    }
];
