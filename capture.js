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
    
    // =================================================================
    // BURAYA YENİ GRAFİK KODUNU YAZMAYI UNUTMA! (URL'deki o karışık kod)
    const chartId = 'cZaSxzAT'; 
    // =================================================================

    // URL'nin sonuna tarih ekleyerek (t=...) her seferinde taze veri çekiyoruz
    const chartUrl = `https://tr.tradingview.com/chart/${chartId}/?t=${Date.now()}&nosync=true`; 
    
    const isManualRun = (eventName === 'workflow_dispatch');
    const trHour = (new Date().getUTCHours() + 3) % 24;
    const isDailyReportTime = (trHour === 18); // Saat 18:00 kuralı

    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/google-chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-cache', '--window-size=1920,1080']
    });

    const context = await browser.createIncognitoBrowserContext();
    const page = await context.newPage();
    await page.setCacheEnabled(false);
    
    // Yeni çerezleri kullan
    const cookies = [
        { name: 'sessionid', value: process.env.SESSION_ID, domain: '.tradingview.com' },
        { name: 'sessionid_sign', value: process.env.SESSION_SIGN, domain: '.tradingview.com' }
    ];
    await page.setCookie(...cookies);
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("Grafiğe giriliyor...");
        await page.goto(chartUrl, { waitUntil: 'load', timeout: 150000 });
        
        console.log("Canlı veri için dürbün ayarı yapılıyor...");
        await page.mouse.click(500, 500); 
        await page.keyboard.press('Space');
        
        await new Promise(r => setTimeout(r, 60000)); // 60sn bekle

        // OCR için renkleri ters çevir (Siyah zemin -> Beyaz zemin)
        await page.addStyleTag({ 
            content: `[class*="layout__area--right"], [class*="widgetbar"] { display: none !important; }
                      .pane-legend, [class*="table"] { filter: invert(100%) contrast(200%) !important; }`
        });

        await page.evaluate(() => { document.body.style.zoom = "150%"; });
        await new Promise(r => setTimeout(r, 5000));

        const clipArea = { x: 1310, y: 0, width: 450, height: 950 };
        await page.screenshot({ path: 'tablo.png', clip: clipArea });

        console.log("Yazılar okunuyor...");
        const result = await Tesseract.recognize('tablo.png', 'tur+eng');
        const lines = result.data.text.split('\n');
        
        let currentSnapshot = {}; 
        let fullReportList = [];  
        
        for (let line of lines) {
            if (!line || line.trim().length < 5) continue;
            let lowerLine = line.toLowerCase();
            let words = line.trim().split(/\s+/);
            
            // Sembol yakalama
            let symbol = words[0]; 
            if (symbol.includes('.') || symbol.length < 2) {
                 if(words.length > 1) symbol = words[1];
            }
            
            let safeSymbol = symbol.replace(/_/g, '\\_'); 
            let rawSymbol = symbol.replace(/\\/g, ''); 

            // Durum Belirleme (Senin yeni indikatöre göre)
            let status = "NÖTR";
            let emoji = "";

            // 1. AL FIRSATI (Bildirim Gidecek)
            if (lowerLine.includes("al") && (lowerLine.includes("firsat") || lowerLine.includes("fırsat"))) {
                status = "ALIŞ";
                emoji = "🟢";
            } 
            // 2. KAR AL (Bildirim Gidecek)
            else if (lowerLine.includes("kar") && lowerLine.includes("al")) {
                status = "SATIŞ";
                emoji = "🔴";
            } 
            // 3. Diğerleri (Sessiz Takip)
            else if (lowerLine.includes("tetik") || lowerLine.includes("hazir")) {
                status = "TETİK";
                emoji = "🟠";
            } else if (lowerLine.includes("dikkat")) {
                status = "DİKKAT";
                emoji = "🟡";
            } else if (lowerLine.includes("bolge") || lowerLine.includes("alim")) {
                status = "ALIM_BOLGESI"; // Bu da sessiz kalacak
                emoji = "🔵";
            }

            if (status !== "NÖTR") {
                currentSnapshot[rawSymbol] = status;
                fullReportList.push(`${emoji} ${safeSymbol}: ${status}`);
            }
        }

        fullReportList.sort();
        const fullReportText = fullReportList.join('\n');

        // Eski durumu oku
        let lastSnapshot = {};
        if (fs.existsSync('state.json')) {
            try {
                let content = JSON.parse(fs.readFileSync('state.json'));
                if (content.snapshot) lastSnapshot = content.snapshot;
            } catch (e) { console.log("Hafıza tazelendi."); }
        }

        // --- BİLDİRİM FİLTRESİ ---
        let notificationLines = [];

        for (let [sym, currentStatus] of Object.entries(currentSnapshot)) {
            let previousStatus = lastSnapshot[sym] || "NÖTR"; 

            // Eğer durum değiştiyse...
            if (currentStatus !== previousStatus) {
                // Sadece "ALIŞ" veya "SATIŞ" ise listeye ekle
                if (currentStatus === "ALIŞ") {
                    notificationLines.push(`🟢 ${sym.replace(/_/g, '\\_')}: AL FIRSATI GELDİ!`);
                } 
                else if (currentStatus === "SATIŞ") {
                    notificationLines.push(`🔴 ${sym.replace(/_/g, '\\_')}: KAR ALMA VAKTİ!`);
                }
            }
        }

        const timestampText = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

        // KARAR ANI
        
        // 1. Kritik Değişiklik Varsa -> FOTOĞRAF AT
        if (notificationLines.length > 0) {
            let message = `🚨 **AL/SAT SİNYALİ** (${timestampText})\n\n` + notificationLines.join('\n');
            await bot.sendPhoto(chatId, 'tablo.png', { caption: message, parse_mode: 'Markdown' });
            console.log("Kritik sinyal gönderildi.");
        }
        
        // 2. Manuel veya Saat 18:00 ise -> RAPOR AT
        else if (isManualRun || isDailyReportTime) {
            const baslik = isManualRun ? "🔄 İsteğin Üzerine Kontrol" : "🕒 Günlük 18.00 Özeti";
            const durumMetni = fullReportText ? fullReportText : "Listede aktif sinyal görünmüyor.";
            
            await bot.sendPhoto(chatId, 'tablo.png', { 
                caption: `${baslik} (${timestampText})\n\n${durumMetni}`,
                parse_mode: 'Markdown'
            });
            console.log("Rapor gönderildi.");
        } 
        
        // 3. Hiçbiri değilse -> SESSİZ KAL
        else {
            console.log("Önemli bir değişiklik yok, sessiz mod.");
        }

        // Durumu kaydet
        fs.writeFileSync('state.json', JSON.stringify({ snapshot: currentSnapshot }));

    } catch (err) {
        console.error("Hata:", err.message);
        if (isManualRun) await bot.sendMessage(chatId, "❌ HATA: " + err.message);
    } finally {
        await browser.close();
    }
}
run();
