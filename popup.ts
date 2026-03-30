type ProductData = {
  productName: string;
  brandName: string;
};

function extractProductDataFromPage(): ProductData {
  const titleElement =
    document.querySelector("h1") ||
    document.querySelector("[data-testid='product-name']") ||
    document.querySelector(".product-name");

  const productName = titleElement?.textContent?.trim() || "Unknown product";

  let brandName = "Unknown brand";
  const hostname = window.location.hostname;

  if (hostname.includes("zara.com")) {
    brandName = "ZARA";
  } else if (hostname.includes("terminalx.com")) {
    brandName = "TERMINAL X";
  }

  return { productName, brandName };
}

document.addEventListener("DOMContentLoaded", async () => {
  const productNameEl = document.getElementById("productName") as HTMLSpanElement;
  const brandNameEl = document.getElementById("brandName") as HTMLSpanElement;
  const searchBtn = document.getElementById("searchBtn") as HTMLButtonElement;

  let currentProduct: ProductData = {
    productName: "Not found",
    brandName: "Not found"
  };

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];

    if (!tab?.id) {
      productNameEl.textContent = "No active tab";
      brandNameEl.textContent = "No active tab";
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractProductDataFromPage
    });

    const data = results[0]?.result;

    if (data) {
      currentProduct = data;
      productNameEl.textContent = data.productName;
      brandNameEl.textContent = data.brandName;
    } else {
      productNameEl.textContent = "No data found";
      brandNameEl.textContent = "No data found";
    }
  } catch (error) {
    productNameEl.textContent = "Could not read page";
    brandNameEl.textContent = "Could not read page";
    console.error(error);
  }

  searchBtn.addEventListener("click", () => {
    const query = `${currentProduct.brandName} ${currentProduct.productName} official store`;
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    chrome.tabs.create({ url });
  });
});