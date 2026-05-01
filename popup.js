"use strict";

let currentBrand = "not found";
let currentProduct = "not found";
let currentProductUrl = "";
let currentSku = "";

// --- פונקציות עזר ורינדור ---

async function loadRecommendations() {
    const storage = await chrome.storage.local.get(["user_id"]);
    const user_id = storage.user_id;
    if (!user_id) return;

    try {
        const res = await fetch(`http://localhost:3000/recommendations/${user_id}`);
        const data = await res.json();
        renderRecommendations(data);
    } catch (err) {
        console.error("Failed to load recommendations", err);
    }
}

function renderRecommendations(recs) {
    const container = document.getElementById("recommendations");
    if (!container) return;
    container.innerHTML = "";
    recs.forEach(r => {
        const div = document.createElement("div");
        div.className = "rec-item";
        div.textContent = `${r.brand} (score: ${Math.round(r.score)})`;
        container.appendChild(div);
    });
}

function renderTerminalResults(data) {
    const resultsContainer = document.getElementById("resultsList");
    if (!resultsContainer) return;

    resultsContainer.innerHTML = `
        <div class="match-item" style="border-left: 5px solid #28a745; background: #fff; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <div class="info-label" style="color: #666; font-size: 12px; font-weight: bold;">TERMINAL X PRICE:</div>
            <div class="info-value" style="color: #28a745; font-size: 24px; font-weight: bold; margin: 10px 0;">
                ${data.price ? '₪' + data.price : 'Not Found'}
            </div>
            <a href="${data.terminalUrl}" target="_blank" class="terminal-link-btn" style="display: block; background: #000; color: #fff; text-align: center; padding: 10px; text-decoration: none; border-radius: 4px; font-weight: bold;">
                View on Terminal X ➔
            </a>
        </div>`;
}

function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
}

function cleanProductTitle(rawTitle, brand) {
    let value = normalizeText(rawTitle);
    if (!value || value === "not found") return "not found";
    const parts = value.split("|").map(p => p.trim()).filter(Boolean);
    value = parts[0] || value;
    if (brand && brand !== "not found") {
        const escapedBrand = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        value = value.replace(new RegExp(`^${escapedBrand}\\s+`, "i"), "").trim();
    }
    return value;
}

async function updateAlertButtonState(productId) {
    const createAlertBtn = document.getElementById("createAlertBtn");
    const alertStatusEl = document.getElementById("alertStatus");
    const userId = "11111111-1111-1111-1111-111111111111"; 

    try {
        const res = await fetch(`http://localhost:3000/stock-alerts/${userId}/${productId}/status`);
        const data = await res.json();
        if (data.exists) {
            createAlertBtn.disabled = true;
            createAlertBtn.textContent = "Alert Active";
            alertStatusEl.textContent = "Tracking this product";
            alertStatusEl.style.color = "green";
        }
    } catch (e) { console.error("Status check failed", e); }
}

// --- אירוע מרכזי: טעינת ה-Popup ---

document.addEventListener("DOMContentLoaded", async () => {
    const productNameEl = document.getElementById("productName");
    const brandNameEl = document.getElementById("brandName");
    const searchBtn = document.getElementById("searchBtn");
    const resultsContainer = document.getElementById("resultsList");
    const alertStatusEl = document.getElementById("alertStatus");
    const createAlertBtn = document.getElementById("createAlertBtn");

    const debugHostname = document.getElementById("debugHostname");
    const debugBrand = document.getElementById("debugBrand");
    const debugProduct = document.getElementById("debugProduct");

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) return;

        // שליפת המק"ט מה-Content Script
        chrome.tabs.sendMessage(tab.id, { action: "GET_PRODUCT_DATA" }, (response) => {
            if (response && response.sku) {
                currentSku = response.sku;
                productNameEl.textContent = currentSku;
                productNameEl.style.color = "#007bff"; // הדגשה שנמצא מק"ט
                productNameEl.style.fontWeight = "bold";
            } else {
                productNameEl.textContent = "SKU not found";
            }
        });

        const injected = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                const getMeta = (p) => {
                    const el = document.querySelector(`meta[property="${p}"], meta[name="${p}"]`);
                    return el ? el.content : null;
                };
                return {
                    hostname: window.location.hostname,
                    url: window.location.href,
                    title: getMeta("og:title") || document.querySelector("h1")?.textContent || document.title,
                    brand: getMeta("product:brand") || getMeta("brand")
                };
            }
        });

        const data = injected[0].result;
        if (data) {
            currentBrand = data.brand || "not found";
            currentProduct = cleanProductTitle(data.title, currentBrand);
            currentProductUrl = data.url;

            brandNameEl.textContent = currentBrand;

            if(debugHostname) debugHostname.textContent = data.hostname;
            if(debugBrand) debugBrand.textContent = currentBrand;
            if(debugProduct) debugProduct.textContent = currentProduct;

            chrome.runtime.sendMessage({
                type: "FIND_OR_CREATE_PRODUCT",
                payload: { brand: currentBrand, product_name: currentProduct, source_url: currentProductUrl }
            }, (res) => {
                if (res && res.ok) {
                    window.currentProductId = res.data.product_id;
                    updateAlertButtonState(res.data.product_id);
                }
            });
        }

    } catch (error) {
        console.error("Init Error:", error);
    }

    // --- כפתור חיפוש בטרמינל איקס - מבוסס מק"ט  ---
    searchBtn.addEventListener("click", async () => {
        // וידוא שהחיפוש מתבצע רק אם יש מק"ט תקין
        if (!currentSku || currentSku === "" || currentSku === "Searching..." || currentSku === "SKU not found") {
            resultsContainer.innerHTML = "<p style='color:orange; text-align:center; font-size:13px;'>⚠️ לא זוהה מק\"ט (SKU) בדף זה. החיפוש בטרמינל איקס דורש מק\"ט מדויק.</p>";
            return;
        }

        searchBtn.disabled = true;
        searchBtn.textContent = "Searching Terminal X...";
        resultsContainer.innerHTML = `
            <div style="text-align:center; padding:15px;">
                <p style="font-size: 13px; color: #666;">מחפש מחיר עבור: <b>${currentSku}</b></p>
                <div class="loader"></div> 
            </div>`;

        try {
            const res = await fetch('http://localhost:3000/url_maker', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sku: currentSku }) // שולח רק את המק"ט
            });
            
            const result = await res.json();
            renderTerminalResults(result);
        } catch (err) {
            console.error("Scraping error:", err);
            resultsContainer.innerHTML = "<p style='color:red; text-align:center;'>שגיאה בחיבור לשרת.</p>";
        } finally {
            searchBtn.disabled = false;
            searchBtn.textContent = "Check Terminal X Price";
        }
    });

    createAlertBtn.addEventListener("click", () => {
        const productId = window.currentProductId;
        if (!productId) return;

        chrome.runtime.sendMessage({
            type: "CREATE_STOCK_ALERT",
            payload: { product_id: productId }
        }, (response) => {
            if (response && response.ok) {
                alertStatusEl.textContent = "✅ Tracking started";
                createAlertBtn.disabled = true;
            }
        });
    });

    await loadRecommendations();
});