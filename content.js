// בתוך content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "GET_PRODUCT_DATA") {
        
        // 1. ניסיון לחלץ מה-URL (הכי אמין באדידס)
        let sku = window.location.pathname.split('/').pop().replace('.html', '');
        
        // 2. גיבוי: חיפוש בתגיות המטא של הדף
        if (!sku || sku.length > 10) { 
            const skuMeta = document.querySelector('meta[itemprop="sku"]') || 
                           document.querySelector('meta[name="sku"]');
            sku = skuMeta ? skuMeta.content : null;
        }

        // 3. גיבוי אחרון: חיפוש אלמנט טקסטואלי שמכיל את המק"ט
        if (!sku) {
            const skuElement = document.querySelector('.gl-label--short') || 
                             document.querySelector('[data-qa="product-number"]');
            sku = skuElement ? skuElement.innerText.trim() : null;
        }

        console.log("Detected SKU:", sku);
        sendResponse({ sku: sku });
    }
    return true; 
});