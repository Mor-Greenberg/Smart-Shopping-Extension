const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const { detectWeb } = require('./visionService');
const { chromium } = require('playwright');
const BRAVE_API_KEY = 'BSAC2UVJ9tlKaTnrXFL7WvL4kOGuM2p';

const app = express();

app.use(cors());
app.use(express.json());

function normalizeText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function normalizeBrand(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/^brand:\s*/i, '')
    .replace(/\boriginals\b/g, '')
    .replace(/\bcollection\b/g, '')
    .replace(/\bbrand\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function refineProductForSearch(product) {
  let value = normalizeText(product).toLowerCase();

  if (!value) return '';

  const removeWords = [
    'joggers',
    'pants',
    'trousers',
    'shoes',
    'sneakers',
    'trainers',
    'boots',
    'leggings',
    'shorts',
    'hoodie',
    'jacket',
    'coat',
    'dress',
    'top',
    'bra',
    'sandals',
    'heels',
    'sliders'
  ];

  for (const word of removeWords) {
    value = value.replace(new RegExp(`\\b${word}\\b`, 'g'), ' ');
  }

  value = value.replace(/\b(leg|fit|style|design|in|with|and|for|the|a|an)\b/g, ' ');
  value = value.replace(/\s+/g, ' ').trim();

  const words = value.split(' ').filter(Boolean);
  return words.slice(0, 5).join(' ');
}

function buildBrandCandidates(brand) {
  const normalized = normalizeBrand(brand);
  if (!normalized) return [];

  const parts = normalized.split(' ').filter(Boolean);
  const compact = normalized.replace(/[^a-z0-9]+/g, '');
  const hyphenated = normalized.replace(/[^a-z0-9]+/g, '-');
  const merged = normalized.replace(/\s+/g, '');

  const candidates = new Set();

  if (compact) candidates.add(compact);
  if (hyphenated) candidates.add(hyphenated);
  if (merged) candidates.add(merged);

  for (const part of parts) {
    if (part.length >= 3) {
      candidates.add(part);
    }
  }

  if (parts.length > 0) {
    candidates.add(parts[0]);
  }

  return Array.from(candidates).filter(Boolean);
}
function looksLikeOfficialBrandUrl(url, brand) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    const brandCandidates = buildBrandCandidates(brand);

    const blockedHosts = [
      'asos.',
      'amazon.',
      'ebay.',
      'walmart.',
      'target.',
      'farfetch.',
      'lyst.',
      'pinterest.',
      'facebook.',
      'instagram.',
      'tiktok.',
      'youtube.',
      'reddit.',
      'stockx.',
      'goat.',
      'poshmark.',
      'shopstyle.',
      'rakuten.',
      'etsy.'
    ];

    for (const blocked of blockedHosts) {
      if (hostname.includes(blocked)) return false;
    }

    return brandCandidates.some(candidate => hostname.includes(candidate));
  } catch {
    return false;
  }
}


function scoreUrl(url, brand, product) {
  const lowerUrl = (url || '').toLowerCase();
  const refinedProduct = refineProductForSearch(product);
  const refinedWords = refinedProduct.split(/\s+/).filter(Boolean);

  let score = 0;

  if (looksLikeOfficialBrandUrl(url, brand)) {
    score += 20;
  }

  if (
    lowerUrl.includes('/product') ||
    lowerUrl.includes('/products') ||
    lowerUrl.includes('/p/') ||
    lowerUrl.includes('/pd/') ||
    lowerUrl.includes('/shop/') ||
    lowerUrl.includes('.html')
  ) {
    score += 8;
  }

  if (
    lowerUrl.includes('/search') ||
    lowerUrl.includes('/women/') ||
    lowerUrl.includes('/men/') ||
    lowerUrl.includes('/kids/') ||
    lowerUrl.includes('/clothing/') ||
    lowerUrl.includes('/shoes/') ||
    lowerUrl.includes('/originals/')
  ) {
    score -= 2;
  }

  for (const word of refinedWords) {
    if (word.length < 3) continue;
    if (lowerUrl.includes(word)) {
      score += 4;
    }
  }

  return score;
}
function isFashionDomain(url) {
  const goodDomains = [
    'asos.',
    'nike.',
    'adidas.',
    'newbalance.',
    'zara.',
    'hm.com',
    'zalando.',
    'footlocker.',
    'jdsports.',
    'dickssportinggoods.',
    'sportsedit.',
    'hibbett.',
    'next.',
    'modesens.',
    'very.co.uk'
  ];

  const badDomains = [
    'mayoclinic.',
    'muscleandstrength.',
    'wikipedia.',
    'youtube.',
    'reddit.',
    'pinterest.'
  ];

  const lowerUrl = url.toLowerCase();

  if (badDomains.some(d => lowerUrl.includes(d))) return false;

  return goodDomains.some(d => lowerUrl.includes(d));
}
function chooseBestLink(pages, brand, product) {
  if (!Array.isArray(pages) || pages.length === 0) {
    return {
      bestLink: null,
      alternatives: [],
      debug: {
        totalPages: 0,
        officialCandidates: 0,
        strategy: 'no-pages'
      }
    };
  }

  const uniquePages = Array.from(
    new Map(
      pages
        .filter(p => p && p.url)
        .map(p => [p.url, { url: p.url }])
    ).values()
  );

  const officialCandidates = uniquePages.filter(p =>
    looksLikeOfficialBrandUrl(p.url, brand)
  );

  console.log('BRAND:', brand);
  console.log('PRODUCT:', product);

  if (officialCandidates.length > 0) {
    const scoredOfficial = officialCandidates
      .map(p => ({
        url: p.url,
        score: scoreUrl(p.url, brand, product)
      }))
      .sort((a, b) => b.score - a.score);

    return {
      bestLink: scoredOfficial[0]?.url || null,
      alternatives: scoredOfficial.slice(1, 6).map(x => x.url),
      debug: {
        totalPages: uniquePages.length,
        officialCandidates: officialCandidates.length,
        strategy: 'official-only',
        scoredOfficial
      }
    };
  }

  const scoredAll = uniquePages
    .map(p => ({
      url: p.url,
      score: scoreUrl(p.url, brand, product)
    }))
    .sort((a, b) => b.score - a.score);

  return {
    bestLink: scoredAll[0]?.url || null,
    alternatives: scoredAll.slice(1, 6).map(x => x.url),
    debug: {
      totalPages: uniquePages.length,
      officialCandidates: 0,
      strategy: 'fallback-all-pages',
      scoredAll: scoredAll.slice(0, 10)
    }
  };
}

function buildProductSearchQuery(brand, product, rawTitle) {
  const cleanBrand = normalizeText(brand).toLowerCase();
  const cleanProduct = normalizeText(product).toLowerCase();
  let cleanRawTitle = normalizeText(rawTitle)
    .replace(/\|\s*asos\s*$/i, '')
    .toLowerCase()
    .trim();

  if (cleanBrand && cleanRawTitle.startsWith(cleanBrand + ' ')) {
    cleanRawTitle = cleanRawTitle.slice(cleanBrand.length).trim();
  }

  const base = cleanRawTitle || cleanProduct || '';

  const query = [cleanBrand, base]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
    console.log('QUERY PARTS:', { cleanBrand, cleanProduct, cleanRawTitle, base });

  return query;
}

async function findCandidateProductPagesBySearch(query) {
  if (!query) return [];

  try {
    const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': BRAVE_API_KEY
      },
      params: {
        q: query,
        count: 10
      }
    });

    const results = response.data?.web?.results || [];

    const candidates = results.map(r => ({
      url: r.url,
      title: r.title
    }));

    console.log('BRAVE RAW RESULTS:', candidates);

    return candidates;
  } catch (err) {
    console.error('Brave search failed:', err.message);
    return [];
  }
}
// health check
app.get('/', (req, res) => {
  res.json({ ok: true, message: 'Server is running' });
});
function filterCandidatePages(pages, sourceUrl = '') {
  const blockedHosts = [
    'asos.com',
    'youtube.com',
    'youtu.be',
    'twitch.tv',
    'facebook.com',
    'instagram.com',
    'tiktok.com',
    'pinterest.com',
    'reddit.com',
    'zenspace.ie',
    'manxharriers.com'
  ];

  const blockedQueryKeys = ['ma', 'z', 'utm_source', 'utm_medium', 'utm_campaign'];

  const blockedPathParts = [
    '/blog',
    '/forum',
    '/news',
    '/article'
  ];

  const sourceNormalized = (sourceUrl || '').trim().toLowerCase();

  return (pages || []).filter(page => {
    if (!page || !page.url) return false;

    const url = page.url.trim();
    const lowerUrl = url.toLowerCase();

    if (!lowerUrl.startsWith('https://')) return false;

    if (sourceNormalized && lowerUrl === sourceNormalized) return false;

    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      const pathname = parsed.pathname.toLowerCase();

      if (blockedHosts.some(blocked => hostname.includes(blocked))) {
        return false;
      }

      if (blockedPathParts.some(part => pathname.includes(part))) {
        return false;
      }

      for (const key of blockedQueryKeys) {
        if (parsed.searchParams.has(key)) {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  });
}
app.post('/analyze-image', async (req, res) => {
  try {
const { imageUrl, brand = '', product = '', productUrl = '', rawTitle = '' } = req.body;
console.log('RAW TITLE:', rawTitle);
const searchQuery = buildProductSearchQuery(brand, product, rawTitle);
console.log('SEARCH QUERY:', searchQuery);
    if (!imageUrl) {
      return res.status(400).json({ error: 'imageUrl is required' });
    }




    const webDetection = await detectWeb(imageUrl);

const pages = (webDetection?.pagesWithMatchingImages || []).map(page => ({
  url: page.url
}));

const filteredPages = filterCandidatePages(pages, productUrl);

console.log('FILTERED PAGES:', filteredPages.map(p => p.url));

const bravePages = await findCandidateProductPagesBySearch(searchQuery);

console.log('BRAVE CANDIDATE PAGES:', bravePages.map(p => p.url));

const mergedPages = [...filteredPages, ...bravePages];

const uniqueCandidatePages = Array.from(
  new Map(
    mergedPages
      .filter(p => p && p.url)
      .filter(p => isFashionDomain(p.url))   
      .map(p => [p.url, p])
  ).values()
);

console.log('FINAL CANDIDATE PAGES:', uniqueCandidatePages.map(p => p.url));

const selection = chooseBestLink(uniqueCandidatePages, brand, product);

console.log('SELECTION:', selection);

return res.json({
  found: !!selection.bestLink,
  bestLink: selection.bestLink,
  alternatives: selection.alternatives,
  debug: selection.debug || {},
  rawPages: uniqueCandidatePages
});

  } catch (error) {
    console.error('Vision failed:', error);
    return res.status(500).json({
      error: 'Vision failed'
    });
  }
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});