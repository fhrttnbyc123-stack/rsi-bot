import puppeteer from "puppeteer-core";

const CHART_URL =
  "https://www.tradingview.com/chart/We6vJ4le/?symbol=FXOPEN:XAUUSD";

(async () => {
  console.log("Chrome başlatılıyor...");

  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1920,1080"
    ]
  });

  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
  );

  console.log("Chart açılıyor...");
  await page.goto(CHART_URL, {
    waitUntil: "networkidle2",
    timeout: 60000
  });

  console.log("Render bekleniyor...");
  await page.waitForTimeout(15000);

  console.log("Ekran görüntüsü alınıyor...");
  await page.screenshot({
    path: "chart.png",
    fullPage: false
  });

  await browser.close();
  console.log("OK: Screenshot alındı");
})();
