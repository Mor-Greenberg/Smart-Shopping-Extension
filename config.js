// config.js

const SITES_CONFIG = {
    "shop.super-pharm.co.il": {
        name: "Super-Pharm",
        displayName: "סופר-פארם",
        siteType: "retail",
        searchUrlPattern: "https://shop.super-pharm.co.il/search?q={{ean}}",
        eanExtraction: {
            type: "dom",
            selector: ".description-ean",
            regex: /(\d+)/
        },
        scrape: {
            waitForSelector: "script[type='application/ld+json'], .item-price, .price-container",
            renderDelay: 3500,
            searchPageHints: ["/search", "?q="],
            productNameVerification: {
                enabled: true,
                trustEanMatch: true,
                minSimilarity: 0.25,
                minMatchingTokens: 2
            },
            priceExtraction: [
                {
                    type: "json-ld",
                    paths: ["offers.price", "offers.lowPrice"]
                },
                {
                    type: "data-attributes",
                    selector: ".item-price",
                    attributes: ["data-discountprice", "data-price"],
                    textSelector: ".shekels"
                },
                {
                    type: "dom",
                    selectors: [
                        ".item-price .shekels",
                        ".price-final_amount",
                        ".current-price",
                        ".sale-price"
                    ],
                    excludeClosest: [".cost-per-unit", ".old-price", "[class*='cost-per-unit']"]
                }
            ],
            navigation: {
                productPageHints: ["/p/"],
                productLinkSelectors: ["a[href*='/p/']"],
                singleResultFallback: false,
                tryProductLinks: true,
                firstResultFallback: false,
                verifyEanOnProductPage: true,
                maxProductAttempts: 5
            }
        }
    },

    "365mashbir.co.il": {
        name: "Mashbir",
        displayName: "משביר",
        siteType: "retail",
        searchUrlPattern: "https://365mashbir.co.il/search?q={{ean}}",
        eanExtraction: {
            strategies: [
                { type: "script", regex: /"barcode"\s*:\s*"(\d{8,14})"/i },
                { type: "script", regex: /"sku"\s*:\s*"(\d{8,14})"/i },
                {
                    type: "page-scan",
                    patterns: [
                        /"barcode"\s*:\s*"(\d{8,14})"/i,
                        /"sku"\s*:\s*"(\d{8,14})"/i
                    ]
                }
            ]
        },
        scrape: {
            renderDelay: 3500,
            searchPageHints: ["/search", "?q="],
            productNameVerification: {
                enabled: true,
                trustEanMatch: true,
                minSimilarity: 0.2,
                minMatchingTokens: 2,
                productPageSelectors: [
                    "h1",
                    ".product-title",
                    ".product-name",
                    "meta[property='og:title']"
                ],
                searchCardTitleSelectors: [
                    "h2", "h3", ".product-title", ".card__heading", "[class*='product-title']"
                ]
            },
            priceExtraction: [
                {
                    type: "data-attributes",
                    selector: "meta[property='og:price:amount']",
                    attributes: ["content"]
                },
                {
                    type: "json-ld",
                    paths: ["offers.price", "offers.lowPrice"]
                },
                {
                    type: "dom",
                    selectors: [
                        ".price-item--regular .price-item__price",
                        ".product__info .price",
                        ".price-wrapper .price",
                        ".final-price",
                        ".product-price"
                    ],
                    excludeClosest: [
                        "input", "select", "textarea",
                        "[name='quantity']", "[id*='Quantity']",
                        "[class*='quantity']", ".quantity"
                    ]
                }
            ],
            navigation: {
                productPageHints: ["/products/"],
                productLinkSelectors: ["a[href*='/products/']"],
                linkAttributeSelectors: [
                    "button.button-label-btn-quickview",
                    "[onclick*='/products/']",
                    "[\\@click\\.prevent*='/products/']",
                    "button[class*='quickview']"
                ],
                linkAttributeRegex: "/products/[^'\"\\)\\s]+",
                productPageConfirmSelector: "h1, .product-title, .product-name",
                singleResultFallback: false,
                tryProductLinks: true,
                // Mashbir search is fuzzy — never blindly take first of many results
                firstResultFallback: false,
                firstResultFallbackOnlyWhenSingle: true,
                verifyEanOnProductPage: true,
                maxProductAttempts: 3
            }
        }
    },

    "www.shufersal.co.il": {
        name: "Shufersal",
        displayName: "שופרסל",
        siteType: "retail",
        requiresEan: true,
        noEanMessage: "מוצר זה לא נתמך בםצפחיפוש באתרים אחרים (אין ברקוד)",
        searchUrlPattern: "https://www.shufersal.co.il/online/he/search?text={{ean}}",
        eanExtraction: {
            strategies: [
                { type: "label", label: "ברקוד" },
                { type: "script", regex: /"(?:gtin13|gtin|ean|barcode)"\s*:\s*"(\d{8,14})"/i },
                {
                    type: "page-scan",
                    patterns: [
                        /ברקוד[\s\S]{0,80}?(\d{8,14})/i,
                        /"(?:gtin13|gtin|ean|barcode)"\s*:\s*"(\d{8,14})"/i
                    ]
                },
                { type: "dom", selector: ".productCode .text", regex: /(\d{13,14})/ }
            ]
        },
        scrape: {
            waitForSelector: ".productPrice, .actualPrice, .miglog-prod-price, script[type='application/ld+json']",
            renderDelay: 5000,
            productNameVerification: {
                enabled: true,
                trustEanMatch: true,
                minSimilarity: 0.25,
                minMatchingTokens: 2
            },
            priceExtraction: [
                {
                    type: "json-ld",
                    paths: ["offers.price", "offers.lowPrice"]
                },
                {
                    type: "dom",
                    selectors: [
                        ".productPrice",
                        ".actualPrice",
                        ".miglog-prod-price",
                        "[class*='productPrice']",
                        "[class*='actualPrice']"
                    ]
                }
            ],
            navigation: {
                productPageHints: ["/p/P_"],
                productLinkPatterns: ["/p/P_{{ean}}", "/p/{{ean}}"],
                productLinkSelectors: ["a[href*='/p/P_']"],
                productLinkExclude: [
                    "/promo/",
                    "/login",
                    "/register",
                    "/coupons",
                    "/wish-lists",
                    "/my-account",
                    "/online/he/s",
                    "/online/he/a",
                    "/online/he/b",
                    "/online/he/f",
                    "/online/he/g",
                    "/online/he/c/"
                ],
                cardSelectors: [".miglog-prod-wrapper", ".tile", "[data-product-code]"],
                singleResultFallback: false
            }
        }
    }
};

const COMPARE_UI_CONFIG = {
    searchTimeoutMs: 30000,
    notFoundMessage: 'המוצר לא נמצא באתרים אחרים'
};

function isSiteEnabled(cfg) {
    return Boolean(cfg) && cfg.enabled !== false;
}

function resolveSiteEntry(hostname) {
    if (!hostname) return null;

    if (SITES_CONFIG[hostname]) return { key: hostname, cfg: SITES_CONFIG[hostname] };

    const withoutWww = hostname.replace(/^www\./, '');
    if (SITES_CONFIG[withoutWww]) return { key: withoutWww, cfg: SITES_CONFIG[withoutWww] };

    const withWww = hostname.startsWith('www.') ? hostname : `www.${hostname}`;
    if (SITES_CONFIG[withWww]) return { key: withWww, cfg: SITES_CONFIG[withWww] };

    return null;
}

function getSiteConfig(hostname) {
    const resolved = resolveSiteEntry(hostname);
    if (!resolved || !isSiteEnabled(resolved.cfg)) return null;
    return resolved.cfg;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SITES_CONFIG,
        COMPARE_UI_CONFIG,
        getSiteConfig,
        isSiteEnabled,
        resolveSiteEntry
    };
}

if (typeof window !== 'undefined') {
    window.SITES_CONFIG = SITES_CONFIG;
    window.COMPARE_UI_CONFIG = COMPARE_UI_CONFIG;
    window.getSiteConfig = getSiteConfig;
    window.isSiteEnabled = isSiteEnabled;
    window.resolveSiteEntry = resolveSiteEntry;
}
