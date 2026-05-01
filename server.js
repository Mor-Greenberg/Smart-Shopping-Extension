const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');
const crypto = require('crypto');
const { Pool } = require('pg');
const puppeteer = require('puppeteer-core');

// --- חיבור למסד נתונים ---
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'smart_shopping_db',
  password: 'morgreenberg',
  port: 5432,
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('DB Error:', err);
  } else {
    console.log('DB Connected Successfully');
  }
});

const app = express();
const port = 3000;

// --- Middlewares ---
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Private-Network", "true");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// --- Routes: General ---
app.get('/', (req, res) => {
  res.send("Price Matcher & Smart Shopping Server is LIVE");
});

// --- פונקציית Scraping משופרת (Puppeteer) ---
async function scrapeTerminalXPrice(url) {
    const puppeteer = require('puppeteer-core');
    const browser = await puppeteer.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // הגדרות אבטחה שמשפרות יציבות
    });
    
    try {
        const page = await browser.newPage();
        
        // אופטימיזציה: אל תטען תמונות או CSS מיותר כדי למנוע Timeout
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'font'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log(`[Puppeteer] Navigating to: ${url}`);
        
        // שינוי ל-domcontentloaded: מחכים שהמבנה יטען, לא מחכים לכל הפרסומות והסקריפטים ברקע
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const priceSelectors = [
            '.final-price_8CiX', // הסלקטור החדש שמצאת!
            '[data-testid="project-price"]',
            '.price_2W9j',
            '.row_2Ysc span'
        ];

        // נחכה 2 שניות ליתר ביטחון שה-JS יזריק את המחיר
        await new Promise(r => setTimeout(r, 2000));

        const price = await page.evaluate((selectors) => {
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el && el.innerText.trim().length > 0) {
                    return el.innerText.replace(/[^\d.]/g, '');
                }
            }
            return null;
        }, priceSelectors);

        await browser.close();
        return price;
    } catch (error) {
        console.error("[Puppeteer] Error:", error.message);
        if (browser) await browser.close();
        return null;
    }
}

// --- Route: Terminal X Price Matcher ---
app.post('/url_maker', async (req, res) => {
  const { sku } = req.body;

  console.log(`\n--- [${new Date().toLocaleTimeString()}] REQUEST RECEIVED ---`);
  console.log(`Searching for SKU: ${sku}`);

  if (!sku || sku === "null" || sku === "Searching..." || sku === "SKU Not Found") {
    return res.status(400).json({ error: "Invalid SKU provided" });
  }

  const terminalUrl = `https://www.terminalx.com/catalogsearch/result?q=${sku}`;

  try {
    const price = await scrapeTerminalXPrice(terminalUrl);
    console.log(`Result for ${sku}: ${price ? '₪' + price : 'Not Found'}`);

    res.json({
      success: true,
      sku: sku,
      terminalUrl: terminalUrl,
      price: price
    });
  } catch (error) {
    console.error(`Error processing ${sku}:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Routes: Database Operations ---

app.post('/products/find-or-create', async (req, res) => {
  const { brand, product_name, source_url } = req.body;
  try {
    let brandResult = await pool.query(`SELECT id FROM brands WHERE name = $1`, [brand]);
    let brandId;

    if (brandResult.rows.length === 0) {
      const insertBrand = await pool.query(
        `INSERT INTO brands (name, official_url) VALUES ($1, '') RETURNING id`, [brand]
      );
      brandId = insertBrand.rows[0].id;
    } else {
      brandId = brandResult.rows[0].id;
    }

    let productResult = await pool.query(
      `SELECT id FROM products WHERE name = $1 AND brand_id = $2`, [product_name, brandId]
    );

    if (productResult.rows.length > 0) {
      return res.json({ product_id: productResult.rows[0].id });
    }

    const newProductId = crypto.randomUUID();
    const newProduct = await pool.query(
      `INSERT INTO products (id, name, brand_id, source_url) VALUES ($1, $2, $3, $4) RETURNING id`,
      [newProductId, product_name, brandId, source_url]
    );

    res.json({ product_id: newProduct.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error finding/creating product');
  }
});

app.post('/products/:id/purchase', async (req, res) => {
  const productId = req.params.id;
  try {
    await pool.query(`UPDATE products SET purchased = TRUE, purchased_at = CURRENT_TIMESTAMP WHERE id = $1`, [productId]);
    await pool.query(`UPDATE stock_alerts SET is_active = FALSE WHERE product_id = $1`, [productId]);
    res.json({ ok: true, message: 'Product marked as purchased' });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error marking product as purchased' });
  }
});

app.post('/event', async (req, res) => {
  const { user_id, product_id, event_type, duration_seconds, session_id } = req.body;
  try {
    if (duration_seconds < 10) return res.status(200).send('Ignored (too short)');

    await pool.query(`INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [user_id]);
    await pool.query(
      `INSERT INTO user_events (user_id, product_id, event_type, duration_seconds, session_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id) DO UPDATE SET duration_seconds = EXCLUDED.duration_seconds`,
      [user_id, product_id, event_type, duration_seconds, session_id]
    );
    res.send('Event saved');
  } catch (err) {
    res.status(500).send('Error saving event');
  }
});

app.get('/recommendations/:userId', async (req, res) => {
  const userId = req.params.userId;
  try {
    const result = await pool.query(`
      SELECT b.name AS brand, SUM(ew.weight) AS score
      FROM user_events ue
      JOIN products p ON ue.product_id = p.id
      JOIN brands b ON p.brand_id = b.id
      JOIN event_weights ew ON ue.event_type = ew.event_type
      WHERE ue.user_id = $1 AND ue.duration_seconds >= 10
      GROUP BY b.name ORDER BY score DESC LIMIT 3`, [userId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).send('Error getting recommendations');
  }
});

// --- Stock Alerts ---

app.post('/stock-alerts', async (req, res) => {
  const { user_id, product_id } = req.body;
  try {
    await pool.query(
      `INSERT INTO stock_alerts (user_id, product_id) VALUES ($1, $2)
       ON CONFLICT (user_id, product_id) DO UPDATE SET is_active = TRUE, requested_at = CURRENT_TIMESTAMP`,
      [user_id, product_id]
    );
    res.json({ ok: true, message: 'Stock alert saved' });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error saving stock alert' });
  }
});

app.get('/stock-alerts/:userId/available', async (req, res) => {
  const userId = req.params.userId;
  try {
    const result = await pool.query(`
      SELECT sa.id AS alert_id, p.id AS product_id, p.name AS product_name, b.name AS brand, p.source_url
      FROM stock_alerts sa
      JOIN products p ON sa.product_id = p.id
      JOIN brands b ON p.brand_id = b.id
      WHERE sa.user_id = $1 AND sa.is_active = TRUE AND p.in_stock = TRUE AND sa.notified_at IS NULL`, [userId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error checking stock alerts' });
  }
});

// --- Start Server ---
app.listen(port, () => {
  console.log(`🚀 Server Running: http://localhost:${port}`);
});