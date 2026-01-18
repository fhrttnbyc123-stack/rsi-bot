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

  // === IFRAME BEKLE ===
  console.log("Login iframe bekleniyor...");
  await page.waitForSelector("iframe", { timeout: 60000 });

  const frames = page.frames();
  const loginFrame = frames.find(f =>
    f.url().includes("accounts.tradingview.com")
  );

  if (!loginFrame) {
    throw new Error("Login iframe bulunamadı");
  }

  console.log("Iframe bulundu, giriş yapılıyor...");

  await loginFrame.waitForSelector('input[type="email"]', { timeout: 60000 });
  await loginFrame.type('input[type="email"]', process.env.TV_EMAIL, { delay: 50 });
  await loginFrame.type('input[type="password"]', process.env.TV_PASSWORD, { delay: 50 });

  await loginFrame.click('button[type="submit"]');

  // === LOGIN TAMAMLANMASINI BEKLE ===
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 120000 });

  console.log("Giriş başarılı, chart açılıyor...");

  await page.goto(
    "https://tr.tradingview.com/chart/We6vJ4le/?symbol=FXOPEN:XAUUSD",
    { waitUntil: "networkidle2" }
  );

  console.log("RSI tablosu bekleniyor...");

  await page.waitForFunction(() => {
    return document.body.innerText.includes("RSI");
  }, { timeout: 120000 });

  console.log("Tablo bulundu, ekran görüntüsü alınıyor...");

  await page.screenshot({
    path: "rsi_table.png",
    fullPage: true
  });

  await browser.close();
  console.log("BİTTİ — HER ŞEY OK");
})();
