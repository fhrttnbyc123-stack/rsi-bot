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
        
        // Tablo ve indikatörlerin yüklenmesi için bekleme
        await new Promise(r => setTimeout(r, 35000));

        // Tabloyu içeren sağ üst bölgeyi fotoğrafla
        await page.screenshot({
            path: 'tablo.png',
            clip: { x: 1400, y: 40, width: 520, height: 700 } 
        });

        console.log("OCR Okuma Başladı...");
        const result = await Tesseract.recognize('tablo.png', 'tur');
        const rawText = result.data.text;
        const text = rawText.toLowerCase(); // Küçük harfe çevirerek ara
        
        console.log("Okunan Ham Metin:", rawText);

        let sinyal = "";
        
        // OCR hatalarına karşı esnek kontrol (Kademeli Alış / Kar Satışı)
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

            // Sinyal değişmişse mesaj at
            if (state.last_signal !== sinyal) {
                await bot.sendMessage(chatId, `Strateji Güncellendi:\n${sinyal}`);
                fs.writeFileSync('state.json', JSON.stringify({ last_signal: sinyal }));
                console.log("Telegram mesajı gönderildi: ", sinyal);
            } else {
                console.log("Sinyal hala aynı, mesaj atılmadı.");
            }
        } else {
            console.log("Tetikleyici bir sinyal (Alış/Satış) bulunamadı.");
        }
    } catch (err) {
        console.error("Hata:", err.message);
    } finally {
        await browser.close();
    }
}
run();
