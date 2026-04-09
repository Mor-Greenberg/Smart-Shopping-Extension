"use strict";

document.addEventListener("DOMContentLoaded", async () => {
    const productNameEl = document.getElementById("productName");
    const brandNameEl = document.getElementById("brandName");
    const debugHostnameEl = document.getElementById("debugHostname");
    const searchBtn = document.getElementById("searchBtn");
    const resultsContainer = document.getElementById("resultsList");

    // בדיקה שהאלמנטים קיימים ב-HTML לפני שממשיכים
    if (!searchBtn || !resultsContainer) {
        console.error("Missing critical HTML elements!");
        return;
    }

    // 1. טעינת תוצאות שמורות
    const savedResults = localStorage.getItem("lastResults");
    if (savedResults) {
        renderLinks(savedResults);
    }

    // 2. חילוץ מידע מהדף
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (tab?.id && !tab.url.startsWith("chrome://")) {
            const injected = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    const img = document.querySelector("meta[property='og:image']")?.content || 
                                document.querySelector(".product-gallery-main-img")?.src ||
                                document.querySelector("img[class*='main-image']")?.src ||
                                document.querySelector("img")?.src;

                    return {
                        product1: document.querySelector("h1")?.textContent?.trim(),
                        brand1: document.querySelector("a[class*='brandName']")?.textContent?.trim(),
                        imageUrl: img
                    };
                }
            });

            const data = injected[0]?.result;
            if (data) {
                productNameEl.textContent = data.product1 || "Product Not Found";
                brandNameEl.textContent = data.brand1 || "Brand Not Found";
                debugHostnameEl.textContent = data.imageUrl || "";
                searchBtn.dataset.imageUrl = data.imageUrl;
            }
        }
    } catch (e) {
        console.error("Injection error:", e);
    }

    // 3. אירוע לחיצה
    searchBtn.addEventListener("click", async () => {
        const imageUrl = searchBtn.dataset.imageUrl;
        if (!imageUrl || imageUrl === "undefined") {
            alert("No image found to scan!");
            return;
        }

        searchBtn.textContent = "Scanning...";
        searchBtn.disabled = true;
        resultsContainer.innerHTML = "<p style='text-align:center;'>Searching...</p>";

        try {
            const response = await fetch('http://localhost:3000/identify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imagePath: imageUrl })
            });

            const result = await response.json();

            if (result.success && result.rawOutput) {
                localStorage.setItem("lastResults", result.rawOutput);
                renderLinks(result.rawOutput);
            } else {
                resultsContainer.innerHTML = "<p>No matches found.</p>";
            }
        } catch (err) {
            resultsContainer.innerHTML = "<p style='color:red;'>Server Error. Is node server.js running?</p>";
        } finally {
            searchBtn.textContent = "Search Product";
            searchBtn.disabled = false;
        }
    });

    function renderLinks(rawOutput) {
        if (!rawOutput) return;
        resultsContainer.innerHTML = "<h4>Found Matches:</h4>";
        const lines = rawOutput.split('\n').map(l => l.trim()).filter(l => l.toLowerCase().includes('http'));

        if (lines.length === 0) {
            resultsContainer.innerHTML += "<p>No links found.</p>";
            return;
        }

        lines.forEach(line => {
            const httpIndex = line.toLowerCase().indexOf('http');
            const cleanLink = line.substring(httpIndex);
            const div = document.createElement('div');
            div.className = 'match-item';
            div.style.padding = "8px";
            div.style.borderBottom = "1px solid #eee";
            const a = document.createElement('a');
            a.href = cleanLink;
            a.textContent = cleanLink;
            a.target = "_blank";
            a.style.fontSize = "11px";
            a.style.color = "#007bff";
            a.style.wordBreak = "break-all";
            div.appendChild(a);
            resultsContainer.appendChild(div);
        });
    }
});