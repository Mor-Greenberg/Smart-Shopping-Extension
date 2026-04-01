"use strict";
document.addEventListener("DOMContentLoaded", async () => {
    const productNameEl = document.getElementById("productName");
    const brandNameEl = document.getElementById("brandName");
    const debugHostnameEl = document.getElementById("debugHostname");
    const debugBrandEl = document.getElementById("debugBrand");
    const debugProductEl = document.getElementById("debugProduct");
    const searchBtn = document.getElementById("searchBtn");
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
                return {
                    hostname: window.location.hostname,
                    title: document.title,
                    brand1: document.querySelector("a[class*='brandName']")?.textContent?.trim() || null,
                    brand2: document.querySelector("[title*='brand page']")?.textContent?.trim() || null,
                    product1: document.querySelector("div[class^='product-name_']")?.textContent?.trim() || null,
                    product2: document.querySelector("#pdp-description-content div[class*='product-name']")?.textContent?.trim() || null
                };
            }
        });
        const data = injected[0]?.result;
        if (!data) {
            productNameEl.textContent = "No data returned";
            brandNameEl.textContent = "No data returned";
            debugHostnameEl.textContent = "no data";
            debugBrandEl.textContent = "no data";
            debugProductEl.textContent = "no data";
            return;
        }
        const brand = data.brand1 || data.brand2 || "not found";
        let rawTitle = data.title || "";
        const englishMatch = rawTitle.match(/[A-Z][A-Z\s]{3,}/);
        let product = englishMatch
            ? englishMatch[0].replace(/\s+/g, " ").trim()
            : "not found";
        productNameEl.textContent = product;
        brandNameEl.textContent = brand;
        debugHostnameEl.textContent = `${data.hostname || "none"} | ${data.title || "no title"}`;
        debugBrandEl.textContent = `brand1=${data.brand1 ?? "null"} | brand2=${data.brand2 ?? "null"}`;
        debugProductEl.textContent = `product1=${data.product1 ?? "null"} | product2=${data.product2 ?? "null"}`;
    }
    catch (error) {
        productNameEl.textContent = "Could not read page";
        brandNameEl.textContent = "Could not read page";
        debugHostnameEl.textContent = "error";
        debugBrandEl.textContent = String(error);
        debugProductEl.textContent = "error";
        console.error(error);
    }
    searchBtn.addEventListener("click", () => {
        const query = `${brandNameEl.textContent} ${productNameEl.textContent} official store`;
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        chrome.tabs.create({ url });
    });
});
