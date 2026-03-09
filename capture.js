const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
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
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-cache', '--window-size=1456,816']
    });

    const context = await browser.createIncognitoBrowserContext();
    const page = await context.newPage();
    await page.setCacheEnabled(false);
    
    const cookies = [
        { name: 'sessionid', value: process.env.SESSION_ID, domain: '.tradingview.com' },
        { name: 'sessionid_sign', value: process.env.SESSION_SIGN, domain: '.tradingview.com' }
    ];
    await page.setCookie(...cookies);
    await page.setViewport({ width: 1456, height: 816 });

    try {
        console.log("Grafiğe giriliyor...");
        await page.goto(chartUrl, { waitUntil: 'load', timeout: 150000 });
        await new Promise(r => setTimeout(r, 8000)); 

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
        await page.mouse.click(500, 400); 
        await page.keyboard.press('Space');
        await new Promise(r => setTimeout(r, 60000)); 

        // Tabloyu DOM'dan oku
        console.log("Tablo DOM'dan okunuyor...");
        const tableData = await page.evaluate(() => {
            // Tüm satırları bul
            const rows = [];
            const allCells = document.querySelectorAll('tr');
            
            for (let row of allCells) {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 3) {
                    const sembol = cells[0]?.innerText?.trim();
                    const rsi    = cells[1]?.innerText?.trim();
                    const sinyal = cells[2]?.innerText?.trim();
                    if (sembol && sinyal && sembol !== 'SEMBOL') {
                        rows.push({ sembol, rsi, sinyal });
                    }
                }
            }
            return rows;
        });

        console.log(`${tableData.length} satır okundu.`);
        console.log(JSON.stringify(tableData));

        // Sinyal emojileri
        function getEmoji(sinyal) {
            const s = sinyal.toUpperCase();
            if (s.includes('AL FIRSATI'))           return '🟢';
            if (s.includes('KAR AL'))               return '🔴';
            if (s.includes('TETIK') || s.includes('TETİK')) return '🟠';
            if (s.includes('ZİRVE') || s.includes('ZIRVE')) return '🟣';
            if (s.includes('ALIM BÖLGESİ') || s.includes('ALIM BOLGE')) return '🔵';
            if (s.includes('DİPTE') || s.includes('DIPTE')) return '⚪';
            if (s.includes('DİKKAT') || s.includes('DIKKAT')) return '🟡';
            if (s.includes('AŞIRI') || s.includes('ASIRI')) return '🔵';
            return '⬛';
        }

        // Önceki durumu yükle
        let lastSnapshot = {};
        if (fs.existsSync('state.json')) {
            try {
                let content = JSON.parse(fs.readFileSync('state.json'));
                if (content.snapshot) lastSnapshot = content.snapshot;
            } catch (e) { console.log("Hafıza tazelendi."); }
        }

        // Mevcut durumu kaydet
        let currentSnapshot = {};
        for (let row of tableData) {
            if (row.sembol && row.sinyal) {
                currentSnapshot[row.sembol] = row.sinyal;
            }
        }

        // Değişimleri bul
        let notificationLines = [];
        for (let [sembol, currentSinyal] of Object.entries(currentSnapshot)) {
            const prevSinyal = lastSnapshot[sembol] || 'NÖTR';
            if (currentSinyal !== prevSinyal) {
                if (currentSinyal.includes('AL FIRSATI')) {
                    notificationLines.push(`🟢 ${sembol}: AL FIRSATI GELDİ! (RSI: ${tableData.find(r=>r.sembol===sembol)?.rsi})`);
                } else if (currentSinyal.includes('KAR AL')) {
                    notificationLines.push(`🔴 ${sembol}: KAR ALMA VAKTİ! (RSI: ${tableData.find(r=>r.sembol===sembol)?.rsi})`);
                }
            }
        }

        // Tam rapor
        const fullReportLines = tableData.map(row => 
            `${getEmoji(row.sinyal)} ${row.sembol}: ${row.sinyal} (RSI: ${row.rsi})`
        );
        const fullReportText = fullReportLines.join('\n');

        const timestampText = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

        if (notificationLines.length > 0) {
            const message = `AL/SAT SİNYALİ (${timestampText})\n\n` + notificationLines.join('\n');
            await bot.sendMessage(chatId, message);
        } else if (isManualRun || isDailyReportTime) {
            const baslik = isManualRun ? "Manuel Kontrol" : "Gunluk 18.00 Ozeti";
            const message = `${baslik} (${timestampText})\n\n${fullReportText || 'Veri okunamadi.'}`;
            await bot.sendMessage(chatId, message);
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
