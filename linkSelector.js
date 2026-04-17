function isSecure(url) {
  return url.startsWith("https://");
}

function isBadDomain(url) {
  const badDomains = [
    "youtube.com",
    "youtu.be",
    "instagram.com",
    "facebook.com",
    "pinterest.com",
    "tiktok.com",
    "reddit.com",
    "soundcloud.com",
    "spotify.com",
    "imdb.com",
    "wikipedia.org"
  ];

  const lowerUrl = url.toLowerCase();
  return badDomains.some(domain => lowerUrl.includes(domain));
}

function isSuspiciousPage(url) {
  const badKeywords = [
    "blog",
    "forum",
    "article",
    "news"
  ];

  const lowerUrl = url.toLowerCase();
  return badKeywords.some(keyword => lowerUrl.includes(keyword));
}

function isCategoryPage(url) {
  const lowerUrl = url.toLowerCase();

  return (
    lowerUrl.includes("/cat") ||
    lowerUrl.includes("category") ||
    lowerUrl.includes("categories") ||
    lowerUrl.includes("page=") ||
    lowerUrl.includes("/new-in/") ||
    lowerUrl.includes("/women/") ||
    lowerUrl.includes("/men/") ||
    lowerUrl.includes("/shoes/") ||
    lowerUrl.includes("/trainers/") ||
    lowerUrl.includes("/a-to-z-of-brands/")
  );
}

function isProductPage(url) {
  const lowerUrl = url.toLowerCase();

  return (
    lowerUrl.includes("/product") ||
    lowerUrl.includes("/products/") ||
    lowerUrl.includes("/p/") ||
    lowerUrl.includes("/dp/") ||
    lowerUrl.includes("/item") ||
    lowerUrl.includes("/prd/") ||
    /\d{5,}/.test(lowerUrl)
  );
}

function getTrustedStoreScore(url) {
  const trustedStores = [
    "amazon.",
    "asos.",
    "zalando.",
    "farfetch.",
    "ebay.",
    "walmart.",
    "target.",
    "nike.",
    "hm.com",
    "zara.",
    "adidas.",
    "newbalance.",
    "puma.",
    "footlocker.",
    "jd sports",
    "jdsports.",
    "terminalx."
  ];

  const lowerUrl = url.toLowerCase();

  for (const store of trustedStores) {
    if (lowerUrl.includes(store)) {
      return 80;
    }
  }

  return 0;
}

function normalizeText(text) {
  return (text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenize(text) {
  return normalizeText(text)
    .split(/\s+/)
    .filter(token => token.length >= 3);
}

function getOfficialSiteScore(url, brand) {
  if (!brand) return 0;

  const normalizedBrand = brand.toLowerCase().replace(/\s+/g, "");
  const domain = new URL(url).hostname.toLowerCase();

  if (
    domain === `${normalizedBrand}.com` ||
    domain.endsWith(`.${normalizedBrand}.com`)
  ) {
    return 200;
  }

  return 0;
}
function getProductMatchScore(url, product) {
  if (!product) return 0;

  const normalizedProduct = product.toLowerCase().replace(/\s+/g, "-");
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes(normalizedProduct.slice(0, 15))) {
    return 50;
  }

  return 0;
}

function getBrandMatchScore(url, brand) {
  if (!brand) return 0;

  const lowerUrl = url.toLowerCase();
  const brandTokens = tokenize(brand);

  let score = 0;

  for (const token of brandTokens) {
    if (lowerUrl.includes(token)) {
      score += 25;
    }
  }

  return score;
}


function chooseBestLink(pages, brand, product = "") {
  const candidates = pages
    .filter(page => page.url)
    .filter(page => isSecure(page.url))
    .filter(page => !isBadDomain(page.url))
    .map(page => {
      const url = page.url;
      let score = 0;

      score += getOfficialSiteScore(url, brand);
      score += getTrustedStoreScore(url);
      score += getBrandMatchScore(url, brand);
      score += getProductMatchScore(url, product);
      

      if (isProductPage(url)) {
        score += 100;
      }
      if (!isProductPage(url)) {
        score -= 100;
        }

      if (isCategoryPage(url)) {
        score -= 150;
      }

      if (isSuspiciousPage(url)) {
        score -= 60;
      }

      return {
        ...page,
        score
      };
    })
    .filter(page => page.score > 0)
    .sort((a, b) => b.score - a.score);

  return {
    bestLink: candidates[0] || null,
    alternatives: candidates.slice(1, 4)
  };
}

module.exports = { chooseBestLink };