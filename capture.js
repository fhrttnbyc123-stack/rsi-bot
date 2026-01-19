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
    
    // URL sonuna zaman ekleyerek TV sunucularını taze veriye zorluyoruz
    const chartUrl = `https://tr.tradingview.com/chart/We6vJ4le/?t=${Date.now()}`; 
    const isManualRun = (eventName === 'workflow_dispatch');
    const trHour = (new Date().getUTCHours() + 3) % 24;
    const isDailyReportTime = (trHour === 18);

    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/google-chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
    });

    const context = await browser.createIncognitoBrowserContext();
    const page = await context.newPage();
    
    await page.setCacheEnabled(false);
    await page.setDefaultNavigationTimeout(180000); 
    
    const cookies = [
        { name: 'sessionid', value: process.env.SESSION_ID, domain: '.tradingview.com' },
        { name: 'sessionid_sign', value: process.env.SESSION_SIGN, domain: '.tradingview.com' }
    ];
    await page.setCookie(...cookies);
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("Grafiğe giriş yapılıyor (Canlı Veri Modu)...");
        
        // 'networkidle0' kullanarak tüm veri akışı bitene kadar beklemesini sağlıyoruz
        await page.goto(chartUrl, { waitUntil: 'networkidle0', timeout: 180000 });
        
        // Pine Script tablolarının hesaplanması zaman alır, 1 dakika sabırla bekliyoruz
        await new Promise(r => setTimeout(r, 70000)); 

        // Sağ paneli temizle
        await page.addStyleTag({ 
            content: `[class*="layout__area--right"], [class*="widgetbar"] { display: none !important; }
                      .pane-legend, [class*="table"] { filter: grayscale(100%) contrast(200%) brightness(150%) !important; }`
        });

        await page.evaluate(() => { document.body.style.zoom = "150%"; });
        await new Promise(r => setTimeout(r, 5000));

        // Koordinatları dünkü "Altın Oran" ayarına sadık kalarak alıyoruz
        const clipArea = { x: 1310, y: 0, width: 450, height: 950 };
        await page.screenshot({ path: 'tablo.png', clip: clipArea });

        if (isManualRun || isDailyReportTime) {
            await bot.sendPhoto(chatId, 'tablo.png', { caption: isManualRun ? "🔄 GÜNCEL Manuel Kontrol" : "🕒 GÜNCEL 18.00 Özeti" });
        }

        console.log("OCR Analizi...");
        const result = await Tesseract.recognize('tablo.png', 'tur+eng');
        const rawText = result.data.text;
        const lines = rawText.split('\n');
        
        let currentSignals = [];
        for (let line of lines) {
            let lowerLine = line.toLowerCase();
            if ((lowerLine.includes("kademel") || lowerLine.includes("ademel")) && 
                (lowerLine.includes("alis") || lowerLine.includes("alıs") || lowerLine.includes("alış"))) {
                let symbol = line.split(' ')[1] || "Sembol";
                currentSignals.push(`🟢 ${symbol}: KADEMELİ ALIŞ`);
            } else if (lowerLine.includes("kar") && 
                       (lowerLine.includes("satis") || lowerLine.includes("satıs") || lowerLine.includes("satış"))) {
                let symbol = line.split(' ')[1] || "Sembol";
                currentSignals.push(`🔴 ${symbol}: KAR SATIŞI`);
            }
        }

        const signalText = currentSignals.join('\n');
        if (signalText !== "") {
            let state = { last_all_signals: "" };
            if (fs.existsSync('state.json')) { state = JSON.parse(fs.readFileSync('state.json')); }

            if (state.last_all_signals !== signalText || isManualRun) {
                if (!isManualRun && !isDailyReportTime) {
                    await bot.sendPhoto(chatId, 'tablo.png', { caption: `🚨 **SİNYAL DEĞİŞTİ**\n\n${signalText}`, parse_mode: 'Markdown' });
                } else if (isManualRun) {
                    await bot.sendMessage(chatId, `📊 **Sinyal Detayları:**\n\n${signalText}`);
                }
                fs.writeFileSync('state.json', JSON.stringify({ last_all_signals: signalText }));
            }
        }
    } catch (err) {
        console.error("Hata:", err.message);
        await bot.sendMessage(chatId, "❌ HATA: Sayfa yüklenemedi. Grafik 'Kaydet' yapıldı mı?");
    } finally {
        await browser.close();
    }
}
run();
