const vision = require('@google-cloud/vision');

async function quickstart() {
    const imagePath = process.argv[2];
    if (!imagePath) {
        console.log("No image path provided");
        return;
    }

    // יצירת הלקוח - וודאי שהנתיב לקובץ ה-JSON נכון
    const client = new vision.ImageAnnotatorClient({
        keyFilename: './google-credentials.json'
    });

    try {
        const [result] = await client.webDetection(imagePath);
        const webDetection = result.webDetection;

        if (webDetection && webDetection.pagesWithMatchingImages && webDetection.pagesWithMatchingImages.length) {
            webDetection.pagesWithMatchingImages.forEach(page => {
                const url = page.url;
                
                // סינון: אל תדפיס לינקים של יוטיוב
                const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
                
                if (!isYouTube) {
                    // מדפיס רק את ה-URL נקי (בלי המילה URL:) כדי שהפופאפ יוכל לקרוא אותו בקלות
                    console.log(url); 
                }
            });
        } else {
            console.log("No matching pages found.");
        }
    } catch (err) {
        console.error('ERROR:', err);
    }
}

quickstart();