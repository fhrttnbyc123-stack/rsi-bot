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

        await page.addStyleTag({ 
            content: `[class*="layout__area--right"], [class*="widgetbar"], .tv-floating-toolbar { display: none !important; }`
        });

        // ZOOM YOK — tablo ekranda olsun

        // Fareyi sağ üste götür, tabloyu opaklaştır
        await page.mouse.move(1400, 200, { steps: 10 });
        await page.mouse.click(1400, 200);
        await new Promise(r => setTimeout(r, 2000));

        // Koordinatı bul
        const coords = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('td, th, div, span'));
            const target = elements.find(el => el.innerText && el.innerText.trim() === 'SEMBOL');
            if (target) {
                const rect = target.getBoundingClientRect();
                return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
            }
            return null;
        });

        console.log(`=== SEMBOL KOORDINATI: ${JSON.stringify(coords)} ===`);

        // Tam ekran al
        await page.screenshot({ path: 'tablo.png' });

        const timestampText = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
        await bot.sendPhoto(chatId, 'tablo.png', { 
            caption: `Koordinat tespiti (${timestampText})\nSEMBOL: ${JSON.stringify(coords)}` 
        });

    } catch (err) {
        console.error("Hata:", err.message);
        if (isManualRun) await bot.sendMessage(chatId, "HATA: " + err.message);
    } finally {
        await browser.close();
    }
}
run();
