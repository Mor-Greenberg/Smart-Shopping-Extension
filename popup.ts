let currentBrand = "not found";
let currentProduct = "not found";
let currentImageUrl = "";
let currentProductUrl = "";
let currentRawTitle = "";

function extractStore(hostname: string): string {
  const knownStores = [
    "asos",
    "amazon",
    "ebay",
    "zalando",
    "farfetch",
    "walmart",
    "target",
    "lyst",
    "terminalx"
  ];

  const lowerHost = (hostname || "").toLowerCase();

  for (const s of knownStores) {
    if (lowerHost.includes(s)) return s;
  }

  return "unknown";
}

function normalizeText(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeBrandForDisplay(brand: string): string {
  return normalizeText(brand).replace(/^brand:\s*/i, "");
}

function cleanProductTitle(rawTitle: string, brand: string): string {
  let value = normalizeText(rawTitle);

  if (!value) return "not found";

  const parts = value.split("|").map(p => p.trim()).filter(Boolean);
  value = parts[0] || value;

  if (brand && brand !== "not found") {
    const escapedBrand = escapeRegex(brand);
    value = value.replace(new RegExp(`^${escapedBrand}\\s+`, "i"), "").trim();
  }

  value = value.replace(/\bin\s+[a-z0-9\s,&/-]+$/i, "").trim();

  value = value.replace(
    /\b(trainers|shoes|sneakers|boots|sandals|heels|sliders)\b\s*$/i,
    ""
  ).trim();

  return value || "not found";
}

function fallbackBrandFromTitle(rawTitle: string): string {
  const title = normalizeText(rawTitle);
  if (!title) return "not found";

  const parts = title.split("|").map(p => p.trim()).filter(Boolean);
  const firstPart = parts[0] || title;

  const words = firstPart.split(/\s+/).filter(Boolean);

  if (words.length === 0) return "not found";

  if (words.length >= 2) {
    return `${words[0]} ${words[1]}`.trim();
  }

  return words[0];
}

function buildGoogleFallbackUrl(brand: string, product: string): string {
  const cleanBrand = normalizeText(brand);
  const cleanProduct = normalizeText(product);

  let query = "";

  if (
    cleanBrand &&
    cleanBrand !== "not found" &&
    cleanProduct &&
    cleanProduct !== "not found"
  ) {
    query = `${cleanBrand} ${cleanProduct}`;
  } else if (cleanProduct && cleanProduct !== "not found") {
    query = cleanProduct;
  } else if (cleanBrand && cleanBrand !== "not found") {
    query = cleanBrand;
  } else {
    query = "product";
  }

  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

document.addEventListener("DOMContentLoaded", async () => {
    console.log("POPUP LOADED");

  const productNameEl = document.getElementById("productName") as HTMLSpanElement;
  const brandNameEl = document.getElementById("brandName") as HTMLSpanElement;
  const debugHostnameEl = document.getElementById("debugHostname") as HTMLSpanElement;
  const debugBrandEl = document.getElementById("debugBrand") as HTMLSpanElement;
  const debugProductEl = document.getElementById("debugProduct") as HTMLSpanElement;
  const searchBtn = document.getElementById("searchBtn") as HTMLButtonElement;
  const resultsListEl = document.getElementById("resultsList") as HTMLDivElement;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id) {
      productNameEl.textContent = "No active tab";
      brandNameEl.textContent = "No active tab";
      return;
    }

    const injected = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        function getMetaByProperty(property: string) {
          const el = document.querySelector(
            `meta[property="${property}"]`
          ) as HTMLMetaElement | null;
          return el?.content || null;
        }

        function getMetaByName(name: string) {
          const el = document.querySelector(
            `meta[name="${name}"]`
          ) as HTMLMetaElement | null;
          return el?.content || null;
        }

        function normalize(value: string | null | undefined) {
          return (value || "").replace(/\s+/g, " ").trim();
        }

        function extractBrandFromJsonLd() {
          const scripts = Array.from(
            document.querySelectorAll('script[type="application/ld+json"]')
          );

          for (const script of scripts) {
            try {
              const text = script.textContent || "";
              if (!text.trim()) continue;

              const parsed = JSON.parse(text);
              const nodes = Array.isArray(parsed) ? parsed : [parsed];

              for (const node of nodes) {
                if (!node) continue;

                if (node["@type"] === "Product") {
                  if (typeof node.brand === "string") {
                    return normalize(node.brand);
                  }
                  if (node.brand?.name) {
                    return normalize(node.brand.name);
                  }
                }

                if (Array.isArray(node["@graph"])) {
                  for (const item of node["@graph"]) {
                    if (item?.["@type"] === "Product") {
                      if (typeof item.brand === "string") {
                        return normalize(item.brand);
                      }
                      if (item.brand?.name) {
                        return normalize(item.brand.name);
                      }
                    }
                  }
                }
              }
            } catch (_) {}
          }

          return null;
        }

        function extractBrandFromDom() {
          const selectors = [
            '[data-testid*="brand"]',
            '[class*="brand"] a',
            '[class*="brand"]',
            'a[href*="/brand/"]'
          ];

          for (const selector of selectors) {
            const elements = Array.from(document.querySelectorAll(selector));

            for (const el of elements) {
              const text = normalize(el.textContent);
              if (text && text.length <= 60) {
                return text;
              }
            }
          }

          return null;
        }

        const ogTitle = getMetaByProperty("og:title");
        const ogImage = getMetaByProperty("og:image");
        const h1 = normalize(document.querySelector("h1")?.textContent || null);

        const metaBrand =
          getMetaByProperty("product:brand") ||
          getMetaByName("brand");

return {
  hostname: window.location.hostname,
  url: window.location.href,
  title: normalize(ogTitle || h1 || document.title),
  h1,
  image: ogImage,
  jsonLdBrand: extractBrandFromJsonLd(),
  domBrand: extractBrandFromDom(),
  metaBrand: normalize(metaBrand)
};
      }
    });

const data = injected[0]?.result as
  | {
      hostname?: string;
      url?: string;
      title?: string;
      h1?: string;
      image?: string | null;
      jsonLdBrand?: string | null;
      domBrand?: string | null;
      metaBrand?: string | null;
    }
  | undefined;

    if (!data) {
      productNameEl.textContent = "No data returned";
      brandNameEl.textContent = "No data returned";
      debugHostnameEl.textContent = "no data";
      debugBrandEl.textContent = "no data";
      debugProductEl.textContent = "no data";
      return;
    }

    const hostname = data.hostname || "";
    const rawTitle = data.title || "";
    const store = extractStore(hostname);

    const extractedBrand =
      normalizeBrandForDisplay(data.jsonLdBrand || "") ||
      normalizeBrandForDisplay(data.domBrand || "") ||
      normalizeBrandForDisplay(data.metaBrand || "") ||
      fallbackBrandFromTitle(rawTitle);

    const brand = extractedBrand || "not found";
    const product = cleanProductTitle(rawTitle, brand);
currentBrand = brand || "not found";
currentProduct = product || "not found";
currentImageUrl = data.image || "";
currentProductUrl = data.url || "";
currentRawTitle = rawTitle || "";

await chrome.storage.local.set({
  current_product_context: {
    brand: currentBrand,
    product_name: currentProduct,
    source_url: currentProductUrl,
    image_url: currentImageUrl,
    raw_title: currentRawTitle,
    updated_at: Date.now()
  }
});

    productNameEl.textContent = currentProduct;
    brandNameEl.textContent = currentBrand;

    debugHostnameEl.textContent = `${hostname} | ${rawTitle}`;
    debugBrandEl.textContent =
      `store=${store} | jsonLd=${data.jsonLdBrand || "none"} | dom=${data.domBrand || "none"} | meta=${data.metaBrand || "none"} | final=${currentBrand}`;
    debugProductEl.textContent =
      `product=${currentProduct} | image=${currentImageUrl || "none"}`;
  } catch (error) {
    productNameEl.textContent = "Could not read page";
    brandNameEl.textContent = "Could not read page";
    debugHostnameEl.textContent = "error";
    debugBrandEl.textContent = String(error);
    debugProductEl.textContent = "error";
    console.error(error);
  }

    searchBtn.addEventListener("click", async () => {
    console.log("BUTTON CLICKED");

    try {
      if (!currentImageUrl) {
        const fallbackUrl = buildGoogleFallbackUrl(currentBrand, currentProduct);
        await chrome.tabs.create({ url: fallbackUrl });
        return;
      }

      resultsListEl.innerHTML = `<p>Searching product page...</p>`;

      const response = await fetch("http://localhost:3000/analyze-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          imageUrl: currentImageUrl,
          brand: currentBrand,
          product: currentProduct,
          productUrl: currentProductUrl,
          rawTitle: currentRawTitle
        })
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const result = await response.json();
      console.log("SERVER RESULT:", result);

      const bestLinkUrl =
        typeof result.bestLink === "string"
          ? result.bestLink
          : result.bestLink?.url || "";

      if (bestLinkUrl) {
        await chrome.tabs.create({ url: bestLinkUrl });
        return;
      }

      const fallbackUrl = buildGoogleFallbackUrl(currentBrand, currentProduct);
      await chrome.tabs.create({ url: fallbackUrl });
    } catch (error) {
      console.error("Search failed:", error);
      const fallbackUrl = buildGoogleFallbackUrl(currentBrand, currentProduct);
      await chrome.tabs.create({ url: fallbackUrl });
    }
  });
  });
  