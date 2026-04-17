"use strict";
function extractProductData() {
    const titleElement = document.querySelector("h1") ||
        document.querySelector("[data-testid='product-name']") ||
        document.querySelector(".product-name");
    let productName = titleElement?.textContent?.trim() || "Unknown product";
    let brandName = "Unknown brand";
    const hostname = window.location.hostname;
    if (hostname.includes("zara.com")) {
        brandName = "ZARA";
    }
    // if (hostname.includes("terminalx.com")) { ... }
    return { productName, brandName };
}
