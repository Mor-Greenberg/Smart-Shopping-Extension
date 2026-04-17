const { chooseBestLink } = require('./linkSelector');

const brand = "adidas";

const testData = [
  { url: "https://www.adidas.com/us/some-product" },
  { url: "https://www.amazon.com/product/123" },
  { url: "http://not-secure-shop.com/item/1" },
  { url: "https://www.youtube.com/watch?v=abc" },
  { url: "https://randomblog.com/article-about-shoes" },
  { url: "https://www.asos.com/adidas-product" }
];

const result = chooseBestLink(testData, brand);

console.log("Best:", result.bestLink);
console.log("Alternatives:", result.alternatives);