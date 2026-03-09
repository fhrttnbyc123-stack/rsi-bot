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
        await page.goto(chartUrl, { waitUntil: 'load', timeout: 150000 });
        await new Promise(r => setTimeout(r, 8000)); 
        await page.mouse.click(500, 400); 
        await page.keyboard.press('Space');
        await new Promise(r => setTimeout(r, 60000)); 

        // SEMBOL yazısının parent HTML yapısını al
        const htmlDump = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            const target = elements.find(el => el.childNodes.length === 1 && el.innerText && el.innerText.trim() === 'SEMBOL');
            if (!target) return 'SEMBOL BULUNAMADI';
            // 5 seviye yukarı çık
            let el = target;
            for (let i = 0; i < 5; i++) {
                if (el.parentElement) el = el.parentElement;
            }
            return el.innerHTML.substring(0, 3000);
        });

        console.log("=== HTML DUMP ===");
        console.log(htmlDump);
        console.log("=== HTML DUMP BİTTİ ===");

        await bot.sendMessage(chatId, "HTML dump alındı, loglara bak.");

    } catch (err) {
        console.error("Hata:", err.message);
        await bot.sendMessage(chatId, "HATA: " + err.message);
    } finally {
        await browser.close();
    }
}
run();
