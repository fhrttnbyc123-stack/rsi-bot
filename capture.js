const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const Tesseract = require('tesseract.js');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

puppeteer.use(StealthPlugin());

async function run() {
    const token = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.CHAT_ID;

    if (!token || !chatId) {
        console.error("HATA: Token veya ID eksik!");
        process.exit(1);
    }

    const bot = new TelegramBot(token);
    const chartUrl = 'https://tr.tradingview.com/chart/We6vJ4le/'; 

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
        
        // Tablonun oturması için bekleme
        await new Promise(r => setTimeout(r, 45000));

        // --- KRİTİK MÜDAHALE: Sağ Paneli (Watchlist) Zorla Gizle ---
        await page.addStyleTag({ 
            content: `
                [class*="layout__area--right"], 
                [class*="widgetbar"], 
                .button-qwRE8uS0 { display: none !important; }
            ` 
        });
        console.log("Yan panel gizlendi.");

        // Yazıları devleştirmek için Zoom
        await page.evaluate(() => {
            document.body.style.zoom = "150%";
        });
        await new Promise(r => setTimeout(r, 3000));

        // Panel kapandığı için tablo artık en sağ üstte (x: 1350 civarı idealdir)
        const clipArea = { x: 1350, y: 0, width: 570, height: 950 };
        
        await page.screenshot({
            path: 'tablo.png',
            clip: clipArea
        });

        await bot.sendPhoto(chatId, 'tablo.png', { caption: "PANEL KAPATILDI: Tablo artık bu alanda aranıyor." });

        console.log("OCR Okuma Başladı...");
        const result = await Tesseract.recognize('tablo.png', 'tur+eng');
        const rawText = result.data.text;
        const text = rawText.toLowerCase();
        
        console.log("Okunan Ham Metin:", rawText);

        let sinyal = "";
        
        // Esnek kelime tarama (Türkçe karakter hatalarına karşı)
        const hasKademeli = text.includes("kademel") || text.includes("ademel");
        const hasAlis = text.includes("alis") || text.includes("alıs") || text.includes("alış") || text.includes("ali");
        const hasKar = text.includes("kar") || text.includes("aar");
        const hasSatis = text.includes("satis") || text.includes("satıs") || text.includes("satış") || text.includes("sati");

        if (hasKademeli && hasAlis) {
            sinyal = "🟢 KADEMELİ ALIŞ YAP";
        } 
        else if (hasKar && hasSatis) {
            sinyal = "🔴 KAR SATIŞI YAP";
        }

        if (sinyal !== "") {
            let state = { last_signal: "" };
            if (fs.existsSync('state.json')) {
                state = JSON.parse(fs.readFileSync('state.json'));
            }

            if (state.last_signal !== sinyal) {
                await bot.sendPhoto(chatId, 'tablo.png', { caption: `🚨 STRATEJİ TETİKLENDİ!\n\n${sinyal}` });
                fs.writeFileSync('state.json', JSON.stringify({ last_signal: sinyal }));
                console.log("Mesaj gönderildi!");
            }
        } else {
            console.log("Sinyal kelimeleri yakalanamadı.");
        }
    } catch (err) {
        console.error("Hata:", err.message);
    } finally {
        await browser.close();
    }
}
run();
