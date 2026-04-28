"use strict";

document.addEventListener("DOMContentLoaded", async () => {
    const productNameEl = document.getElementById("productName");
    const resultsContainer = document.getElementById("resultsList");
    const searchBtn = document.getElementById("searchBtn");

    console.log("--- Popup Opened ---");

    // חילוץ מק"ט מיד עם פתיחת הפופ-אפ
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        console.log("Target Tab ID:", tab.id);

        chrome.tabs.sendMessage(tab.id, { action: "GET_PRODUCT_DATA" }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Communication Error:", chrome.runtime.lastError.message);
                productNameEl.textContent = "Error: Refresh Adidas page";
                return;
            }

            if (response && response.sku) {
                console.log("SKU successfully extracted:", response.sku);
                productNameEl.textContent = response.sku;
                searchBtn.dataset.sku = response.sku;
            } else {
                console.warn("Content script returned empty SKU.");
                productNameEl.textContent = "SKU Not Found";
            }
        });
    } catch (e) {
        console.error("Popup Init Error:", e);
    }

    // חיפוש מחיר רק בלחיצה
    searchBtn.addEventListener("click", async () => {
        const sku = searchBtn.dataset.sku;
        if (!sku) {
            alert("Please wait for SKU to be detected or refresh the page.");
            return;
        }

        console.log(`Calling server for SKU: ${sku}`);
        searchBtn.textContent = "Searching...";
        searchBtn.disabled = true;

        try {
            const res = await fetch('http://localhost:3000/url_maker', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sku: sku })
            });
            const data = await res.json();
            console.log("Response from server:", data);

            renderResults(data);
        } catch (err) {
            console.error("Fetch Error:", err);
            resultsContainer.innerHTML = "<p style='color:red;'>Server Error. Is Node running?</p>";
        } finally {
            searchBtn.textContent = "Check Again";
            searchBtn.disabled = false;
        }
    });

    function renderResults(data) {
        resultsContainer.innerHTML = `
            <div class="match-item">
                <div class="info-label">TERMINAL X PRICE:</div>
                <div class="info-value" style="color: #28a745; font-size: 18px;">
                    ${data.price ? '₪' + data.price : 'Not Found in Stock'}
                </div>
                <a class="match-link" href="${data.terminalUrl}" target="_blank">View on Terminal X ➔</a>
            </div>`;
    }
});