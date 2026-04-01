// שינוי השורה הראשונה לפורמט שתואם את ברירת המחדל של Node.js
const vision = require('@google-cloud/vision');

console.log("Script is running...");

const client = new vision.ImageAnnotatorClient({
  keyFilename: './google-credentials.json'
});

async function findProductLinks() {
  const imagePath = './test_image.jpg'; 
  console.log("--- Starting Google Image Scan ---");

  try {
    const [result] = await client.webDetection(imagePath);
    const fullMatchingImages = result.webDetection?.pagesWithMatchingImages;

    if (fullMatchingImages && fullMatchingImages.length > 0) {
      console.log("\nFound websites featuring this product:");
      fullMatchingImages.forEach((page: any, index: number) => {
        console.log(`${index + 1}. ${page.url}`);
      });
    } else {
      console.log("Google could not find any matching websites for this image.");
    }
  } catch (error) {
    console.error("An error occurred during the API request:", error);
  }
}

findProductLinks();