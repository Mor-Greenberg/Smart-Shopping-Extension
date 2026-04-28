// content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "GET_PRODUCT_DATA") {
        let sku = null;

        // שיטה משופרת: חילוץ מהחלק האחרון של הכתובת
        const pathname = window.location.pathname; // מחזיר למשל /he/.../JQ2029.html
        
        // ה-Regex הזה מחפש את התווים בין הסלאש האחרון לנקודה האחרונה
        const urlMatch = pathname.match(/\/([^\/]+)\.html$/);
        
        if (urlMatch && urlMatch[1]) {
            sku = urlMatch[1].toUpperCase();
        }

        // גיבוי למקרה שה-URL לא מכיל .html
        if (!sku) {
            const parts = pathname.split('/');
            const lastPart = parts[parts.length - 1];
            sku = lastPart.replace('.html', '').toUpperCase();
        }

        console.log("Extracted SKU:", sku);
        sendResponse({ sku: sku });
    }
    return true; 
});