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
        await new Promise(r => setTimeout(r, 8000)); 

        console.log("Reklam ve uyarılar kontrol ediliyor...");
        await page.evaluate(() => {
            const closeElements = document.querySelectorAll('button[class*="close"], [data-name="close"], .tv-dialog__close');
            for (let el of closeElements) { if (el && el.click) el.click(); }
            const allButtons = document.querySelectorAll('button, div[role="button"], span');
            for (let btn of allButtons) {
                let text = (btn.innerText || "").toLowerCase().trim();
                if (text === 'reddet' || text === 'hayır' || text.includes('teklifi reddet') || text === 'kapat') {
                    if (btn.click) btn.click();
                }
            }
        });
        
        await new Promise(r => setTimeout(r, 2000)); 
        await page.mouse.click(500, 500); 
        await page.keyboard.press('Space');
        await new Promise(r => setTimeout(r, 60000)); 

        // Sağ panel, toolbar ve fiyat eksenini gizle
        await page.addStyleTag({ 
            content: `
                [class*="layout__area--right"],
                [class*="widgetbar"],
                .tv-floating-toolbar,
                [class*="price-axis"],
                [class*="pane-legend"],
                [data-name="legend"] { display: none !important; }
            `
        });

        // Zoom düşürüldü: 185 → 130
        await page.evaluate(() => { document.body.style.zoom = "130%"; });
        await new Promise(r => setTimeout(r, 3000));

        // Tabloyu bul ve üstüne git
        console.log("Tablonun yeri aranıyor...");
        const tablePos = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('td, th, div, span'));
            const target = elements.find(el => el.innerText && el.innerText.trim() === 'SEMBOL');
            if (target) {
                const rect = target.getBoundingClientRect();
                return { x: rect.x + 30, y: rect.y + 30 };
            }
            return { x: 800, y: 150 };
        });

        console.log(`Fare: x=${tablePos.x}, y=${tablePos.y}`);
        await page.mouse.move(tablePos.x, tablePos.y, { steps: 10 });
        await page.mouse.click(tablePos.x, tablePos.y);
        await new Promise(r => setTimeout(r, 2000));

        // Tablonun tam konumunu al
        const tableRect = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('td, th, div, span'));
            const header = elements.find(el => el.innerText && el.innerText.trim() === 'SEMBOL');
            if (header) {
                // En yakın tablo elementini bul
                let el = header;
                while (el && el.tagName !== 'TABLE' && !el.className.includes('table')) {
                    el = el.parentElement;
                    if (!el) break;
                }
                if (el) {
                    const rect = el.getBoundingClientRect();
                    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                }
                // Tablo bulunamazsa header konumundan tahmin et
                const rect = header.getBoundingClientRect();
                return { x: rect.x - 5, y: rect.y - 5, width: 420, height: 700 };
            }
            return null;
        });

        let clipArea;
        if (tableRect && tableRect.width > 50) {
            // Tabloyu tam kırp, biraz padding ekle
            clipArea = {
                x: Math.max(0, tableRect.x - 10),
                y: Math.max(0, tableRect.y - 10),
                width: Math.min(tableRect.width + 20, 1920),
                height: Math.min(tableRect.height + 20, 1080)
            };
            console.log(`Tablo otomatik bulundu: ${JSON.stringify(clipArea)}`);
        } else {
            // Fallback: sabit değerler
            clipArea = { x: 60, y: 60, width: 480, height: 980 };
            console.log("Tablo bulunamadı, fallback kullanılıyor.");
        }

        await page.screenshot({ path: 'tablo.png', clip: clipArea });
        console.log("Ekran görüntüsü alındı.");

        console.log("OCR başlıyor...");
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
                if (words.length > 1) symbol = words[1];
            }
            if (symbol.includes("bolge") || symbol.includes("alim") || symbol.length > 15) continue;
            
            let safeSymbol = symbol.replace(/[_*[\]()~`>#+\-=|{}.!]/g, ' ').trim();
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
                if (currentStatus === "ALIŞ") notificationLines.push(`🟢 ${sym}: AL FIRSATI GELDI!`);
                else if (currentStatus === "SATIŞ") notificationLines.push(`🔴 ${sym}: KAR ALMA VAKTI!`);
            }
        }

        const timestampText = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

        if (notificationLines.length > 0) {
            let message = `BEKAP Pro Sinyal (${timestampText})\n\n` + notificationLines.join('\n');
            await bot.sendPhoto(chatId, 'tablo.png', { caption: message });
        } else if (isManualRun || isDailyReportTime) {
            const baslik = isManualRun ? "Manuel Kontrol" : "Gunluk 18.00 Ozeti";
            const durumMetni = fullReportText ? fullReportText : "Listede aktif sinyal yok.";
            await bot.sendPhoto(chatId, 'tablo.png', { caption: `${baslik} (${timestampText})\n\n${durumMetni}` });
        } else {
            console.log("Sessiz mod.");
        }

        fs.writeFileSync('state.json', JSON.stringify({ snapshot: currentSnapshot }));

    } catch (err) {
        console.error("Hata:", err.message);
        if (isManualRun) await bot.sendMessage(chatId, "HATA: " + err.message);
    } finally {
        await browser.close();
    }
}
run();
