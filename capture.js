const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const Tesseract = require('tesseract.js');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

puppeteer.use(StealthPlugin());

async function run() {
    const token = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.CHAT_ID;
    const eventName = process.env.GITHUB_EVENT_NAME; 
    const bot = new TelegramBot(token);
    
    const chartUrl = `https://tr.tradingview.com/chart/We6vJ4le/?t=${Date.now()}`; 
    const isManualRun = (eventName === 'workflow_dispatch');
    const trHour = (new Date().getUTCHours() + 3) % 24;
    const isDailyReportTime = (trHour === 18);

    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/google-chrome',
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage', // GitHub Actions için bellek optimizasyonu
            '--disable-gpu',           // Ekran kartı gereksinimini kaldır
            '--window-size=1920,1080'
        ]
    });

    const context = await browser.createIncognitoBrowserContext();
    const page = await context.newPage();
    
    // 1. ÖNLEM: Gereksiz kaynakları (resim, reklam vb.) engelleyerek hızı artır
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['image', 'media', 'font', 'stylesheet'].includes(resourceType) && !req.url().includes('chart')) {
            req.abort(); // Sadece grafik ve tablo için gerekli olanları yükle
        } else {
            req.continue();
        }
    });

    await page.setCacheEnabled(false);
    await page.setDefaultNavigationTimeout(180000); // Süreyi 3 dakikaya çıkardık
    
    const cookies = [
        { name: 'sessionid', value: process.env.SESSION_ID, domain: '.tradingview.com' },
        { name: 'sessionid_sign', value: process.env.SESSION_SIGN, domain: '.tradingview.com' }
    ];
    await page.setCookie(...cookies);

    try {
        console.log("Grafiğe giriş yapılıyor (Hızlı Yükleme Modu)...");
        // 'commit' kullanarak sayfa yanıt vermeye başladığı an kontrolü devralıyoruz
        await page.goto(chartUrl, { waitUntil: 'domcontentloaded', timeout: 180000 });
        
        // Tablonun gelmesi için bekleme süresi
        await new Promise(r => setTimeout(r, 60000)); 

        // Yan paneli gizle ve OCR filtresi uygula
        await page.addStyleTag({ 
            content: `[class*="layout__area--right"], [class*="widgetbar"] { display: none !important; }
                      .pane-legend, [class*="table"] { filter: grayscale(100%) contrast(200%) brightness(150%) !important; }`
        });

        await page.evaluate(() => { document.body.style.zoom = "150%"; });
        await new Promise(r => setTimeout(r, 5000));

        const clipArea = { x: 1310, y: 0, width: 450, height: 950 };
        await page.screenshot({ path: 'tablo.png', clip: clipArea });

        if (isManualRun || isDailyReportTime) {
            await bot.sendPhoto(chatId, 'tablo.png', { caption: isManualRun ? "🔄 Güncel Manuel Kontrol" : "🕒 Güncel 18.00 Özeti" });
        }

        console.log("OCR Analizi...");
        const result = await Tesseract.recognize('tablo.png', 'tur+eng');
        const lines = result.data.text.split('\n');
        
        let currentSignals = [];
        for (let line of lines) {
            let lowerLine = line.toLowerCase();
            let words = line.trim().split(/\s+/);
            let symbol = words[1] || words[0] || "Sembol";
            
            if ((lowerLine.includes("kademel") || lowerLine.includes("ademel")) && 
                (lowerLine.includes("alis") || lowerLine.includes("alıs") || lowerLine.includes("alış"))) {
                currentSignals.push(`🟢 ${symbol}: KADEMELİ ALIŞ`);
            } else if (lowerLine.includes("kar") && 
                       (lowerLine.includes("satis") || lowerLine.includes("satıs") || lowerLine.includes("satış"))) {
                currentSignals.push(`🔴 ${symbol}: KAR SATIŞI`);
            }
        }

        const signalText = currentSignals.join('\n');
        if (signalText !== "") {
            let state = { last_all_signals: "" };
            if (fs.existsSync('state.json')) { state = JSON.parse(fs.readFileSync('state.json')); }

            if (state.last_all_signals !== signalText || isManualRun) {
                if (!isManualRun && !isDailyReportTime) {
                    await bot.sendPhoto(chatId, 'tablo.png', { caption: `🚨 **CANLI DEĞİŞİKLİK**\n\n${signalText}`, parse_mode: 'Markdown' });
                } else if (signalText !== "") {
                    await bot.sendMessage(chatId, `📊 **Güncel Sinyaller:**\n\n${signalText}`);
                }
                fs.writeFileSync('state.json', JSON.stringify({ last_all_signals: signalText }));
            }
        }
    } catch (err) {
        console.error("Hata:", err.message);
        await bot.sendMessage(chatId, "❌ Yükleme Hatası (Timeout). Sayfa çok ağır veya oturumda sorun var.");
    } finally {
        await browser.close();
    }
}
run();
