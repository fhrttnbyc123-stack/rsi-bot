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
    
    // CHART ID
    const chartId = 'cZaSxzAT'; 
    
    const chartUrl = `https://tr.tradingview.com/chart/${chartId}/?t=${Date.now()}&nosync=true`; 
    
    const isManualRun = (eventName === 'workflow_dispatch');
    const trHour = (new Date().getUTCHours() + 3) % 24;
    const isDailyReportTime = (trHour === 18);

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
        console.log("Grafiğe giriliyor...");
        await page.goto(chartUrl, { waitUntil: 'load', timeout: 150000 });
        
        // REKLAMIN ÇIKMASI İÇİN BİRAZ BEKLE
        await new Promise(r => setTimeout(r, 8000)); 

        // --- OTOMATİK REKLAM KAPATICI ---
        console.log("Reklam ve uyarılar kontrol ediliyor...");
        await page.evaluate(() => {
            const closeElements = document.querySelectorAll('button[class*="close"], [data-name="close"], .tv-dialog__close');
            for (let el of closeElements) { 
                if (el && el.click) el.click(); 
            }
            
            const allButtons = document.querySelectorAll('button, div[role="button"], span');
            for (let btn of allButtons) {
                let text = (btn.innerText || "").toLowerCase().trim();
                if (text === 'reddet' || text === 'hayır' || text.includes('teklifi reddet') || text === 'kapat') {
                    if (btn.click) btn.click();
                }
            }
        });
        
        await new Promise(r => setTimeout(r, 2000)); 
        
        console.log("Canlı veri...");
        await page.mouse.click(500, 500); 
        await page.keyboard.press('Space');
        
        await new Promise(r => setTimeout(r, 60000)); 

        // GEREKSİZLERİ GİZLE VE FİLTREYİ UYGULA
        await page.addStyleTag({ 
            content: `[class*="layout__area--right"], [class*="widgetbar"], .tv-floating-toolbar { display: none !important; }
                      .pane-legend, [class*="table"] { filter: invert(100%) contrast(200%) !important; }`
        });

        // ZOOM AYARI (%185)
        await page.evaluate(() => { document.body.style.zoom = "185%"; });
        await new Promise(r => setTimeout(r, 5000));

        // --- GELİŞMİŞ OPAKLAŞTIRMA (GERÇEKÇİ HOVER) ---
        console.log("Tablo opaklaştırılıyor...");
        // Işınlanmak yerine gerçek bir insan gibi fareyi kaydırarak götürüyoruz (steps: 20)
        await page.mouse.move(500, 200); 
        await page.mouse.move(700, 300, { steps: 20 });
        await page.mouse.move(900, 400, { steps: 20 });
        await page.mouse.move(800, 350, { steps: 10 });
        
        // Tablonun öne gelmesini garantilemek için üstüne ufak bir sol tık yapıyoruz
        await page.mouse.click(800, 350);
        await new Promise(r => setTimeout(r, 1500)); // Efektin oturması için bekle

        // --- KADRAJ AYARI (DAHA SOLA ÇEKİLDİ) ---
        // x: 500 (Daha da sola çektik, yazılar asla kesilmez)
        // width: 1200 (Genişliği büyük tuttuk ki tüm tabloyu kapsasın)
        const clipArea = { x: 500, y: 0, width: 1200, height: 1080 };
        await page.screenshot({ path: 'tablo.png', clip: clipArea });

        console.log("Okunuyor...");
        const result = await Tesseract.recognize('tablo.png', 'tur+eng');
        const lines = result.data.text.split('\n');
        
        let currentSnapshot = {}; 
        let fullReportList = [];  
        
        for (let line of lines) {
            if (!line || line.trim().length < 5) continue;
            let lowerLine = line.toLowerCase();
            let words = line.trim().split(/\s+/);
            
            let symbol = words[0]; 
            if (symbol.includes('.') || symbol.length < 2) {
                 if(words.length > 1) symbol = words[1];
            }
            if (symbol.includes("bolge") || symbol.includes("alim") || symbol.length > 15) continue;
            
            let safeSymbol = symbol.replace(/_/g, '\\_'); 
            let rawSymbol = symbol.replace(/\\/g, ''); 

            let status = "NÖTR";
            let emoji = "";

            if (lowerLine.includes("al") && (lowerLine.includes("firsat") || lowerLine.includes("fırsat"))) {
                status = "ALIŞ"; emoji = "🟢";
            } else if (lowerLine.includes("kar") && lowerLine.includes("al")) {
                status = "SATIŞ"; emoji = "🔴";
            } else if (lowerLine.includes("tetik") || lowerLine.includes("hazir")) {
                status = "TETİK"; emoji = "🟠";
            } else if (lowerLine.includes("dikkat")) {
                status = "DİKKAT"; emoji = "🟡";
            } else if (lowerLine.includes("bolge") || lowerLine.includes("alim")) {
                status = "ALIM_BOLGESI"; emoji = "🔵";
            } else if (lowerLine.includes("zirve") || lowerLine.includes("guclu")) {
                status = "ZİRVE"; emoji = "🟣";
            } else if (lowerLine.includes("dipte") || lowerLine.includes("bekle")) {
                 status = "DİPTE"; emoji = "⚪";
            }

            if (status !== "NÖTR") {
                currentSnapshot[rawSymbol] = status;
                fullReportList.push(`${emoji} ${safeSymbol}: ${status}`);
            }
        }

        fullReportList.sort();
        const fullReportText = fullReportList.join('\n');

        let lastSnapshot = {};
        if (fs.existsSync('state.json')) {
            try {
                let content = JSON.parse(fs.readFileSync('state.json'));
                if (content.snapshot) lastSnapshot = content.snapshot;
            } catch (e) { console.log("Hafıza tazelendi."); }
        }

        let notificationLines = [];
        for (let [sym, currentStatus] of Object.entries(currentSnapshot)) {
            let previousStatus = lastSnapshot[sym] || "NÖTR"; 
            if (currentStatus !== previousStatus) {
                if (currentStatus === "ALIŞ") notificationLines.push(`🟢 ${sym.replace(/_/g, '\\_')}: AL FIRSATI GELDİ!`);
                else if (currentStatus === "SATIŞ") notificationLines.push(`🔴 ${sym.replace(/_/g, '\\_')}: KAR ALMA VAKTİ!`);
            }
        }

        const timestampText = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

        if (notificationLines.length > 0) {
            let message = `🚨 **AL/SAT SİNYALİ** (${timestampText})\n\n` + notificationLines.join('\n');
            await bot.sendPhoto(chatId, 'tablo.png', { caption: message, parse_mode: 'Markdown' });
        }
        else if (isManualRun || isDailyReportTime) {
            const baslik = isManualRun ? "🔄 İsteğin Üzerine Kontrol" : "🕒 Günlük 18.00 Özeti";
            const durumMetni = fullReportText ? fullReportText : "Listede aktif sinyal yok.";
            await bot.sendPhoto(chatId, 'tablo.png', { caption: `${baslik} (${timestampText})\n\n${durumMetni}`, parse_mode: 'Markdown' });
        } 
        else {
            console.log("Sessiz mod.");
        }
        fs.writeFileSync('state.json', JSON.stringify({ snapshot: currentSnapshot }));

    } catch (err) {
        console.error("Hata:", err.message);
        if (isManualRun) await bot.sendMessage(chatId, "❌ HATA: " + err.message);
    } finally {
        await browser.close();
    }
}
run();
