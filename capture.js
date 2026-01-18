const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const Tesseract = require('tesseract.js');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN);
const chatId = process.env.CHAT_ID;
// Kendi chart linkini buraya koy (Login gerektiren asıl link)
const chartUrl = 'https://tr.tradingview.com/chart/We6vJ4le/'; 

async function run() {
    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/google-chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    // ADIM: Çerezleri Enjekte Et (Login aşamasını atlar)
    const cookies = [
        { name: 'sessionid', value: process.env.SESSION_ID, domain: '.tradingview.com' },
        { name: 'sessionid_sign', value: process.env.SESSION_SIGN, domain: '.tradingview.com' }
    ];
    await page.setCookie(...cookies);

    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("Grafiğe giriş yapılıyor...");
        await page.goto(chartUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Tablonun ve Pine Script'in render olması için 30 saniye bekle
        await new Promise(r => setTimeout(r, 30000));

        // Tablonun olduğu sağ üst bölgeyi çek
        await page.screenshot({
            path: 'tablo.png',
            clip: { x: 1450, y: 50, width: 450, height: 500 } 
        });

        console.log("OCR Okuma Başladı...");
        const result = await Tesseract.recognize('tablo.png', 'tur');
        const text = result.data.text;
        console.log("Okunan Metin:", text);

        let sinyal = "";
        // Senin Pine Script'indeki tam kelimeleri buraya yaz
        if (text.includes("Kademeli Alis")) sinyal = "🔔 Kademeli Alış Yap";
        if (text.includes("Kar Satisi")) sinyal = "🔔 Kar Satışı Yap";

        if (sinyal !== "") {
            let state = { last_signal: "" };
            if (fs.existsSync('state.json')) {
                state = JSON.parse(fs.readFileSync('state.json'));
            }

            if (state.last_signal !== sinyal) {
                await bot.sendMessage(chatId, sinyal);
                fs.writeFileSync('state.json', JSON.stringify({ last_signal: sinyal }));
                console.log("Sinyal gönderildi.");
            }
        }
    } catch (err) {
        console.error("Hata oluştu:", err.message);
    } finally {
        await browser.close();
    }
}
run();
