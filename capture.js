const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const Tesseract = require('tesseract.js');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN);
const chatId = process.env.CHAT_ID;
const chartUrl = 'https://tr.tradingview.com/chart/We6vJ4le/'; 

async function run() {
    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/google-chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
    });

    const page = await browser.newPage();
    
    const cookies = [
        { name: 'sessionid', value: process.env.SESSION_ID, domain: '.tradingview.com' },
        { name: 'sessionid_sign', value: process.env.SESSION_SIGN, domain: '.tradingview.com' }
    ];
    await page.setCookie(...cookies);
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("Grafiğe giriş yapılıyor...");
        await page.goto(chartUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Pine Script ve Tablonun oturması için bekleme
        await new Promise(r => setTimeout(r, 40000));

        // Teşhis için koordinatları biraz genişlettim
        const clipArea = { x: 1350, y: 30, width: 550, height: 800 };
        
        await page.screenshot({
            path: 'tablo.png',
            clip: clipArea
        });

        // --- TEŞHİS ADIMI: Fotoğrafı Telegram'a gönder ---
        await bot.sendPhoto(chatId, 'tablo.png', { caption: "Botun şu an okuduğu alan budur." });
        console.log("Teşhis fotoğrafı Telegram'a gönderildi.");

        console.log("OCR Okuma Başladı...");
        const result = await Tesseract.recognize('tablo.png', 'tur');
        const text = result.data.text.toLowerCase();
        
        console.log("Okunan Ham Metin:", result.data.text);

        let sinyal = "";
        if (text.includes("kademeli") && (text.includes("alis") || text.includes("ali"))) {
            sinyal = "🔔 Kademeli Alış Yap";
        } else if (text.includes("kar") && (text.includes("satis") || text.includes("sati"))) {
            sinyal = "🔔 Kar Satışı Yap";
        }

        if (sinyal !== "") {
            let state = { last_signal: "" };
            if (fs.existsSync('state.json')) {
                state = JSON.parse(fs.readFileSync('state.json'));
            }

            if (state.last_signal !== sinyal) {
                await bot.sendMessage(chatId, `Strateji Güncellendi:\n${sinyal}`);
                fs.writeFileSync('state.json', JSON.stringify({ last_signal: sinyal }));
            }
        } else {
            console.log("Tetikleyici bir sinyal bulunamadı.");
        }
    } catch (err) {
        console.error("Hata:", err.message);
        await bot.sendMessage(chatId, "Bot Hata Aldı: " + err.message);
    } finally {
        await browser.close();
    }
}
run();
