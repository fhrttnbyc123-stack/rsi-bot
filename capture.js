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

    // 1. Zoom yok, doğal 1920x1080 çözünürlük
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

        // 2. GÜVENLİ FİLTRE: Ekranı karartmadan sadece tabloyu netleştirir.
        // Yan panelleri gizle ve tabloyu "Beyaz kağıt üstüne siyah yazı" moduna al.
        await page.addStyleTag({ 
            content: `
                [class*="layout__area--right"], [class*="widgetbar"], .tv-floating-toolbar { display: none !important; }
                
                /* Tablo katmanlarını hedefle, önce beyaz arka plan ver, sonra ters çevir */
                [class*="table-"], .pane-legend, [data-name="legend"] {
                    background-color: #ffffff !important;
                    filter: invert(100%) contrast(250%) brightness(105%) !important;
                }
            `
        });

        // Zoom komutu YOK. Sayfa doğal boyutunda.

        await new Promise(r => setTimeout(r, 5000));

        // 3. NOKTA ATIŞI KADRAJ (1920x1080 ekran için sağ üst köşe)
        // x: 1420 -> Soldan yeterince uzak, grafik girmez.
        // y: 40   -> Üstteki menü çubuğunu atlar.
        // width: 500 -> Tablo rahatça sığar.
        // height: 1040 -> Alt kısma kadar iner.
        const clipArea = { x: 1420, y: 40, width: 500, height: 1040 };
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
            
            // Sembol yakalama (Daha sağlam mantık)
            let symbol = words[0];
            
            // Eğer ilk kelime "BOLGESINE", "ALIM", "TETIKTE" gibi indikatör kelimesiyse, bu satırı atla (Hatalı okuma)
            if (symbol.includes("bolge") || symbol.includes("alim") || symbol.includes("tetik") || symbol.length < 2) {
                continue;
            }
            // Eğer "1. XU100" gibi sayı varsa ikinciyi al
            if (symbol.includes('.') && words.length > 1) {
                 symbol = words[1];
            }
            
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
        } else {
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
