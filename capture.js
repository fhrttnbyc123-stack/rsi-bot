const puppeteer = require("puppeteer");

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 3000 });

  await page.goto(
    "https://tr.tradingview.com/chart/We6vJ4le/?symbol=FXOPEN%3AXAUUSD",
    { waitUntil: "networkidle2" }
  );

  // ⚠️ TradingView login gerekiyorsa burada yapılacak (sonra ekleyeceğiz)

  console.log("Sayfa açıldı, tablo bekleniyor...");

  // TABLO GELENE KADAR BEKLE (sleep değil!)
  await page.waitForFunction(() => {
    return [...document.querySelectorAll("div")]
      .some(el => el.innerText?.includes("Kademeli"));
  }, { timeout: 60000 });

  console.log("Tablo bulundu, ekran görüntüsü alınıyor...");

  await page.screenshot({
    path: "tv_full.png",
    fullPage: true
  });

  await browser.close();
})();
