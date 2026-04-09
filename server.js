const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send("<h1>Server is Running!</h1>");
});

app.post('/identify', (req, res) => {
    const { imagePath } = req.body;
    
    if (!imagePath) {
        return res.status(400).json({ error: "Missing imagePath" });
    }

    console.log(`🚀 Calling test_vision for: ${imagePath}`);

    // השורה המעודכנת: משתמשים ב-node כדי להריץ את ה-js
    exec(`node test_vision.js "${imagePath}"`, (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ Error: ${error.message}`);
            return res.status(500).json({ success: false, error: error.message });
        }
        
        console.log(`✅ Results found!`);
        res.json({ success: true, rawOutput: stdout });
    });
});

app.listen(port, () => {
    console.log(`=========================================`);
    console.log(`🚀 Server is LIVE at http://localhost:${port}`);
    console.log(`=========================================`);
});