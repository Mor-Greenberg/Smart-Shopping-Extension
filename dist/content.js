// content.js
"use strict";

function extractProductData() {
    const titleElement = document.querySelector("h1") ||
        document.querySelector("[data-testid='product-name']") ||
        document.querySelector(".product-name");
    
    // חיפוש תמונת המוצר המרכזית
    const imgElement = document.querySelector("meta[property='og:image']") || 
                       document.querySelector("img[class*='product']") ||
                       document.querySelector("img");

    let productName = titleElement?.textContent?.trim() || "Unknown product";
    let imageUrl = imgElement?.content || imgElement?.src || "";
    let brandName = "Unknown brand";
    
    const hostname = window.location.hostname;
    if (hostname.includes("zara.com")) {
        brandName = "ZARA";
    }

    return { productName, brandName, imageUrl };
}

// מאזין להודעות מהפופ-אפ
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "GET_PRODUCT_DATA") {
        sendResponse(extractProductData());
    }
});