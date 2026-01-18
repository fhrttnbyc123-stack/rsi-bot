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

  // === EMAIL BUTONUNU BEKLE VE TIKLA ===
  console.log("E-posta ile giriş butonu bekleniyor...");
  await page.waitForSelector('button[data-name="email"]', { timeout: 60000 });
  await page.click('button[data-name="email"]');

  console.log("Email butonuna tıklandı, iframe bekleniyor...");

  // === IFRAME OLUŞSUN ===
  await page.waitForSelector("iframe", { timeout: 60000 });

  const loginFrame = page.frames().find(f =>
    f.url().includes("accounts.tradingview.com")
  );

  if (!loginFrame) {
    throw new Error("Login iframe hala bulunamadı");
  }

  console.log("Iframe bulundu, giriş yapılıyor...");

  await loginFrame.waitForSelector('input[type="email"]', { timeout: 60000 });
  await loginFrame.type('input[type="email"]', process.env.TV_EMAIL, { delay: 40 });
  await loginFrame.type('input[type="password"]', process.env.TV_PASSWORD, { delay: 40 });

  await loginFrame.click('button[type="submit"]');

  // === GİRİŞ TAMAMLANSIN ===
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
  console.log("BİTTİ — SCREENSHOT ALINDI");
})();
