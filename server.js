const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// דף בית לבדיקה שהשרת דולק
app.get('/', (req, res) => {
    res.send("Price Matcher Server is LIVE");
});

// ה-Endpoint המרכזי עם לוגים מפורטים
app.post('/url_maker', async (req, res) => {
    const { sku } = req.body;

    console.log(`\n--- [${new Date().toLocaleTimeString()}] NEW REQUEST ---`);
    console.log(`[Step 1] Received SKU from extension: ${sku}`);

    if (!sku || sku === "null" || sku === "Searching...") {
        console.log(`[!] Aborting: SKU is missing or invalid.`);
        return res.status(400).json({ error: "Invalid SKU" });
    }

    const terminalUrl = `https://www.terminalx.com/catalogsearch/result?q=${sku}`;
    console.log(`[Step 2] Target URL: ${terminalUrl}`);

    try {
        console.log(`[Step 3] Fetching data from Terminal X...`);
        const response = await axios.get(terminalUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 8000
        });

        console.log(`[Step 4] Response received. Status: ${response.status}`);
        const html = response.data;

        // Regex גמיש למחיר
        const priceRegex = /"final_price":\s*"?([\d.]+)"?/;
        const match = html.match(priceRegex);
        const price = match ? match[1] : null;

        if (price) {
            console.log(`[Step 5] SUCCESS: Found price ₪${price}`);
        } else {
            console.log(`[Step 5] WARNING: Page loaded but price not found in HTML (Out of stock?)`);
        }

        res.json({
            success: true,
            sku: sku,
            terminalUrl: terminalUrl,
            price: price
        });

    } catch (error) {
        console.error(`[!] ERROR: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
    console.log(`--- Request Finished ---\n`);
});

app.listen(port, () => {
    console.log(`=========================================`);
    console.log(`🚀 Server Running: http://localhost:${port}`);
    console.log(`=========================================`);
});