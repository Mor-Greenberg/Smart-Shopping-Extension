const vision = require('@google-cloud/vision');

const client = new vision.ImageAnnotatorClient({
  keyFilename: './google-credentials.json'
});

async function detectWeb(imageSource) {
  const [result] = await client.webDetection(imageSource);
  return result.webDetection || {};
}

module.exports = { detectWeb };