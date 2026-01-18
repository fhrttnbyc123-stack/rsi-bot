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
    
    // 1920x1080 standart ekran boyutu
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("Grafiğe giriş yapılıyor...");
        await page.goto(chartUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Tablonun ve Pine Script'in yüklenmesi için 45 saniye bekle
        await new Promise(r => setTimeout(r, 45000));

        // --- AMELİYAT: Tabloyu Yakınlaştır ---
        // Sayfayı %150 zoom yaparak yazıların daha büyük okunmasını sağlıyoruz
        await page.evaluate(() => {
            document.body.style.zoom = "150%";
        });
        await new Promise(r => setTimeout(r, 2000));

        // Görselde gördüğümüz tabloya göre yeni koordinatlar (Zoom sonrası)
        // x: 1000 civarı tabloyu ortalar
        const clipArea = { x: 1000, y: 10, width: 850, height: 900 };
        
        await page.screenshot({
            path: 'tablo.png',
            clip: clipArea
        });

        // Teşhis için yeni (yakınlaşmış) fotoğrafı gönder
        await bot.sendPhoto(chatId, 'tablo.png', { caption: "YAKIN ÇEKİM: OCR bu alanı okuyor." });

        console.log("OCR Okuma Başladı...");
        // 'tur+eng' kullanarak Türkçe karakter hatalarını azaltıyoruz
        const result = await Tesseract.recognize('tablo.png', 'tur+eng');
        const rawText = result.data.text;
        const text = rawText.toLowerCase();
        
        console.log("Okunan Ham Metin:", rawText);

        let sinyal = "";
        
        // Gönderdiğin görseldeki "🔔 Kademeli Alış Yap" yazısını yakalamak için:
        if ((text.includes("kademeli") || text.includes("kademelı")) && 
            (text.includes("alis") || text.includes("alıs") || text.includes("alış") || text.includes("ali"))) {
            sinyal = "🟢 KADEMELİ ALIŞ YAP";
        } 
        else if (text.includes("kar") && 
                (text.includes("satis") || text.includes("satıs") || text.includes("satış") || text.includes("sati"))) {
            sinyal = "🔴 KAR SATIŞI YAP";
        }

        if (sinyal !== "") {
            let state = { last_signal: "" };
            if (fs.existsSync('state.json')) {
                state = JSON.parse(fs.readFileSync('state.json'));
            }

            if (state.last_signal !== sinyal) {
                // Sinyal değiştiğinde tabloyu da gönder ki kanıt olsun
                await bot.sendPhoto(chatId, 'tablo.png', { caption: `🚨 STRATEJİ DEĞİŞTİ!\n\n${sinyal}` });
                fs.writeFileSync('state.json', JSON.stringify({ last_signal: sinyal }));
                console.log("Sinyal gönderildi.");
            } else {
                console.log("Sinyal hala aynı, tekrar gönderilmedi.");
            }
        } else {
            console.log("Tetikleyici (Alış/Satış) yazısı bulunamadı.");
        }
    } catch (err) {
        console.error("Hata:", err.message);
    } finally {
        await browser.close();
    }
}
run();
