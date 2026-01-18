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

  // === EMAIL GİRİŞ TETİKLEME (ESNEK) ===
  console.log("Email giriş yolu aranıyor...");

  const emailClicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button, div"));
    const target = buttons.find(el =>
      el.innerText?.toLowerCase().includes("e-posta") ||
      el.innerText?.toLowerCase().includes("email")
    );
    if (target) {
      target.click();
      return true;
    }
    return false;
  });

  if (emailClicked) {
    console.log("Email giriş tetiklendi.");
  } else {
    console.log("Email butonu bulunamadı, iframe direkt aranacak.");
  }

  // === IFRAME BEKLE ===
  await page.waitForSelector("iframe", { timeout: 60000 });

  const loginFrame = page.frames().find(f =>
    f.url().includes("accounts.tradingview.com")
  );

  if (!loginFrame) {
    throw new Error("Login iframe bulunamadı");
  }

  console.log("Login iframe bulundu.");

  await loginFrame.waitForSelector('input[type="email"]', { timeout: 60000 });
  await loginFrame.type('input[type="email"]', process.env.TV_EMAIL, { delay: 40 });
  await loginFrame.type('input[type="password"]', process.env.TV_PASSWORD, { delay: 40 });
  await loginFrame.click('button[type="submit"]');

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
  console.log("BİTTİ");
})();
