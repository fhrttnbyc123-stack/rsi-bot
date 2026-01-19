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
    const chartUrl = 'https://tr.tradingview.com/chart/We6vJ4le/'; 

    const now = new Date();
    const trHour = (now.getUTCHours() + 3) % 24;
    const isDailyReportTime = (trHour === 18);
    const isManualRun = (eventName === 'workflow_dispatch');

    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/google-chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
    });

    const page = await browser.newPage();
    
    // ZAMAN AŞIMI AYARI: 30 saniye sınırını 120 saniyeye çıkarıyoruz
    await page.setDefaultNavigationTimeout(120000); 
    
    const cookies = [
        { name: 'sessionid', value: process.env.SESSION_ID, domain: '.tradingview.com' },
        { name: 'sessionid_sign', value: process.env.SESSION_SIGN, domain: '.tradingview.com' }
    ];
    await page.setCookie(...cookies);
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("Grafiğe giriş yapılıyor...");
        // 'domcontentloaded' kullanarak sayfanın ana iskeleti kurulur kurulmaz içeri dalıyoruz
        await page.goto(chartUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
        
        // Pine Script ve tablonun gelmesi için uzun bekleme süresi
        await new Promise(r => setTimeout(r, 60000)); 

        const isLoggedIn = await page.evaluate(() => {
            return !document.body.innerHTML.includes('Giriş yap');
        });

        if (!isLoggedIn) {
            await bot.sendMessage(chatId, "⚠️ UYARI: TradingView Oturumu Kapanmış veya Sayfa Yüklenemedi!");
            return;
        }

        await page.addStyleTag({ 
            content: `[class*="layout__area--right"], [class*="widgetbar"] { display: none !important; }
                      .pane-legend, [class*="table"] { filter: grayscale(100%) contrast(200%) brightness(150%) !important; }`
        });

        await page.evaluate(() => { document.body.style.zoom = "150%"; });
        await new Promise(r => setTimeout(r, 5000));

        const clipArea = { x: 1310, y: 0, width: 450, height: 950 };
        await page.screenshot({ path: 'tablo.png', clip: clipArea });

        if (isManualRun || isDailyReportTime) {
            await bot.sendPhoto(chatId, 'tablo.png', { caption: isManualRun ? "🔄 Manuel Kontrol" : "🕒 18.00 Özeti" });
        }

        console.log("OCR Analizi yapılıyor...");
        const result = await Tesseract.recognize('tablo.png', 'tur+eng');
        const lines = result.data.text.split('\n');
        
        let currentSignals = [];
        for (let line of lines) {
            let lowerLine = line.toLowerCase();
            let words = line.trim().split(/\s+/);
            let symbol = words[1] || words[0] || "Bilinmiyor";
            
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
                    await bot.sendPhoto(chatId, 'tablo.png', { caption: `🚨 **DEĞİŞİKLİK**\n\n${signalText}`, parse_mode: 'Markdown' });
                } else {
                    await bot.sendMessage(chatId, `📊 **Sinyaller:**\n\n${signalText}`);
                }
                fs.writeFileSync('state.json', JSON.stringify({ last_all_signals: signalText }));
            }
        }
    } catch (err) {
        console.error("Hata:", err.message);
        await bot.sendMessage(chatId, "❌ Bot Hatası: " + err.message + "\n(Sayfa çok yavaş yükleniyor olabilir.)");
    } finally {
        await browser.close();
    }
}
run();
