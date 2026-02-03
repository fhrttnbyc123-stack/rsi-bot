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
    // DÜZELTME BURADA: SENİN YENİ ID'Nİ YAZDIM
    const chartId = 'cZaSxzAT'; 
    // =================================================================

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
        
        console.log("Canlı veri...");
        await page.mouse.click(500, 500); 
        await page.keyboard.press('Space');
        
        await new Promise(r => setTimeout(r, 60000)); 

        // SEVDİĞİN RENK FİLTRESİ
        await page.addStyleTag({ 
            content: `[class*="layout__area--right"], [class*="widgetbar"], .tv-floating-toolbar { display: none !important; }
                      .pane-legend, [class*="table"] { filter: invert(100%) contrast(200%) !important; }`
        });

        // ZOOM AYARI (Senin istediğin yakınlık)
        await page.evaluate(() => { document.body.style.zoom = "150%"; });
        await new Promise(r => setTimeout(r, 5000));

        // KADRAJ AYARI
        // x: 1290 (1310'dan biraz sola çektim ki kenarı kesilmesin, tam ortalasın)
        // width: 600 (Genişliği artırdım, garanti olsun)
        // height: 1080 (Tam boy)
        const clipArea = { x: 1290, y: 0, width: 600, height: 1080 };
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
            // Hatalı okumaları engelle
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
            console.log("Kritik sinyal gönderildi.");
        }
        else if (isManualRun || isDailyReportTime) {
            const baslik = isManualRun ? "🔄 İsteğin Üzerine Kontrol" : "🕒 Günlük 18.00 Özeti";
            const durumMetni = fullReportText ? fullReportText : "Listede aktif sinyal yok.";
            await bot.sendPhoto(chatId, 'tablo.png', { caption: `${baslik} (${timestampText})\n\n${durumMetni}`, parse_mode: 'Markdown' });
            console.log("Rapor gönderildi.");
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
