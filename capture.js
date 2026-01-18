const puppeteer = require("puppeteer-core");

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1920,3000"
    ],
    executablePath: "/usr/bin/google-chrome"
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 3000 });

  console.log("TradingView login sayfası açılıyor...");
  await page.goto("https://www.tradingview.com/accounts/signin/", {
    waitUntil: "networkidle2"
  });

  await page.waitForSelector('input[name="username"]');
  await page.type('input[name="username"]', process.env.TV_EMAIL, { delay: 50 });
  await page.type('input[name="password"]', process.env.TV_PASSWORD, { delay: 50 });

  await page.click('button[type="submit"]');

  console.log("Giriş yapılıyor...");
  await page.waitForNavigation({ waitUntil: "networkidle2" });

  console.log("Chart açılıyor...");
  await page.goto(
    "https://tr.tradingview.com/chart/We6vJ4le/?symbol=FXOPEN:XAUUSD",
    { waitUntil: "networkidle2" }
  );

  console.log("İndikatör tablosu bekleniyor...");

  await page.waitForFunction(() => {
    return document.body.innerText.includes("RSI");
  }, { timeout: 120000 });

  console.log("Tablo bulundu, ekran görüntüsü alınıyor...");

  await page.screenshot({
    path: "rsi_table.png",
    fullPage: true
  });

  await browser.close();
  console.log("Bitti.");
})();
