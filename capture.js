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
    
    // Her seferinde benzersiz URL (Önbellek önleyici)
    const chartUrl = `https://tr.tradingview.com/chart/We6vJ4le/?t=${Date.now()}&nosync=true`; 
    const isManualRun = (eventName === 'workflow_dispatch');
    const trHour = (new Date().getUTCHours() + 3) % 24;
    const isDailyReportTime = (trHour === 18); // Saat 18'de rapor at

    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/google-chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-cache', '--window-size=1920,1080']
    });

    const context = await browser.createIncognitoBrowserContext();
    const page = await context.newPage();
    await page.setCacheEnabled(false);
    
    const cookies = [
        { name: 'sessionid', value: process.env.SESSION_ID, domain: '.tradingview.com' },
        { name: 'sessionid_sign', value: process.env.SESSION_SIGN, domain: '.tradingview.com' }
    ];
    await page.setCookie(...cookies);
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("Grafiğe giriş yapılıyor...");
        await page.goto(chartUrl, { waitUntil: 'load', timeout: 150000 });
        
        // Veriyi Canlandırma (Dürtme)
        console.log("WebSocket uyandırılıyor...");
        await page.mouse.click(500, 500); 
        await page.keyboard.press('Space');
        
        // Tablonun güncellenmesi için bekleme
        await new Promise(r => setTimeout(r, 90000)); 

        await page.addStyleTag({ 
            content: `[class*="layout__area--right"], [class*="widgetbar"] { display: none !important; }
                      .pane-legend, [class*="table"] { filter: grayscale(100%) contrast(200%) brightness(150%) !important; }`
        });

        await page.evaluate(() => { document.body.style.zoom = "150%"; });
        await new Promise(r => setTimeout(r, 5000));

        const clipArea = { x: 1310, y: 0, width: 450, height: 950 };
        await page.screenshot({ path: 'tablo.png', clip: clipArea });

        // --- OCR VE FİLTRELEME ---
        console.log("OCR Analizi yapılıyor...");
        const result = await Tesseract.recognize('tablo.png', 'tur+eng');
        const lines = result.data.text.split('\n');
        
        let activeSignals = [];
        
        for (let line of lines) {
            let lowerLine = line.toLowerCase();
            // Sembolü yakala
            let symbol = line.trim().split(/\s+/)[1] || line.trim().split(/\s+/)[0] || "Sembol";

            // 1. DURUM: ALIŞ FIRSATI (Yeşil)
            if ((lowerLine.includes("kademel") || lowerLine.includes("ademel")) && 
                (lowerLine.includes("alis") || lowerLine.includes("alıs") || lowerLine.includes("alış"))) {
                activeSignals.push(`🟢 ${symbol}: KADEMELİ ALIŞ`);
            } 
            // 2. DURUM: SATIŞ FIRSATI (Kırmızı)
            else if (lowerLine.includes("kar") && 
                    (lowerLine.includes("satis") || lowerLine.includes("satıs") || lowerLine.includes("satış"))) {
                activeSignals.push(`🔴 ${symbol}: KAR SATIŞI`);
            }
            // 3. DURUM: TETİKTE OL (Turuncu) -> Sadece "Tetik" kelimesine bakar
            else if (lowerLine.includes("tetik") || lowerLine.includes("hazir")) {
                activeSignals.push(`🟠 ${symbol}: TETİKTE OL`);
            }
        }

        activeSignals.sort();
        const signalText = activeSignals.join('\n');

        // --- KARAR MEKANİZMASI ---
        let state = { last_active_signals: "" };
        if (fs.existsSync('state.json')) { state = JSON.parse(fs.readFileSync('state.json')); }

        const timestampText = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

        // SENARYO 1: DURUM DEĞİŞTİ (Acil Haber)
        if (state.last_active_signals !== signalText) {
            if (signalText !== "") {
                await bot.sendPhoto(chatId, 'tablo.png', { 
                    caption: `🚨 **PİYASA HAREKETLENDİ** (${timestampText})\n\n${signalText}`,
                    parse_mode: 'Markdown'
                });
            } else {
                await bot.sendMessage(chatId, `ℹ️ **Piyasa Duruldu** (${timestampText})\nAktif sinyal kalmadı, herkes beklemede.`);
            }
            fs.writeFileSync('state.json', JSON.stringify({ last_active_signals: signalText }));
            console.log("Değişiklik tespit edildi, mesaj atıldı.");
        } 
        
        // SENARYO 2: 18.00 RAPORU veya MANUEL (Rutin Haber)
        else if (isManualRun || isDailyReportTime) {
            const baslik = isManualRun ? "🔄 Manuel Kontrol" : "🕒 Günlük 18.00 Raporu";
            // Sinyal varsa listele, yoksa "Sakin" yaz
            const durumMetni = signalText ? signalText : "Şu an aktif işlem sinyali (Alış/Satış/Tetik) yok.";
            
            await bot.sendPhoto(chatId, 'tablo.png', { 
                caption: `${baslik} (${timestampText})\n\n${durumMetni}`,
                parse_mode: 'Markdown'
            });
            console.log("Rutin rapor gönderildi.");
        } 
        
        else {
            console.log("Sessizlik modu: Değişiklik yok, saat rutin değil.");
        }

    } catch (err) {
        console.error("Hata:", err.message);
        if (isManualRun) await bot.sendMessage(chatId, "❌ HATA: " + err.message);
    } finally {
        await browser.close();
    }
}
run();
