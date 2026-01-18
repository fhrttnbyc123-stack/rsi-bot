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
        
        // Pine Script ve Tablonun tam oturması için bekleme
        await new Promise(r => setTimeout(r, 45000));

        // Yan paneli gizle ve OCR için yüksek kontrast filtresi uygula
        await page.addStyleTag({ 
            content: `
                [class*="layout__area--right"], [class*="widgetbar"] { display: none !important; }
                .pane-legend, [class*="table"] { 
                    filter: grayscale(100%) contrast(200%) brightness(150%) !important; 
                }
            ` 
        });

        // %150 Zoom ile yazıları devleştir
        await page.evaluate(() => { document.body.style.zoom = "150%"; });
        await new Promise(r => setTimeout(r, 3000));

        // --- ALTIN ORAN KOORDİNATLARI ---
        const clipArea = { x: 1310, y: 0, width: 450, height: 950 };
        
        await page.screenshot({ path: 'tablo.png', clip: clipArea });

        console.log("OCR Analizi yapılıyor...");
        const result = await Tesseract.recognize('tablo.png', 'tur+eng');
        const text = result.data.text.toLowerCase();
        
        // Sinyal Kelime Kontrolleri (OCR Hatalarına Karşı Esnek)
        const hasKademeli = text.includes("kademel") || text.includes("ademel");
        const hasAlis = text.includes("alis") || text.includes("alıs") || text.includes("alış") || text.includes("ali");
        const hasKar = text.includes("kar") || text.includes("aar");
        const hasSatis = text.includes("satis") || text.includes("satıs") || text.includes("satış") || text.includes("sati");

        let sinyalMesaji = "";
        if (hasKademeli && hasAlis) {
            sinyalMesaji = "🟢 KADEMELİ ALIŞ YAP";
        } else if (hasKar && hasSatis) {
            sinyalMesaji = "🔴 KAR SATIŞI YAP";
        }

        if (sinyalMesaji !== "") {
            let state = { last_signal: "" };
            if (fs.existsSync('state.json')) {
                state = JSON.parse(fs.readFileSync('state.json'));
            }

            // Sadece sinyal değiştiğinde bildirim gönder
            if (state.last_signal !== sinyalMesaji) {
                const timestamp = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
                const finalCaption = `🚨 **STRATEJİ SİNYALİ** 🚨\n\n` +
                                     `Durum: ${sinyalMesaji}\n` +
                                     `Zaman: ${timestamp}\n\n` +
                                     `_Sinyal tablodan otomatik okundu._`;

                await bot.sendPhoto(chatId, 'tablo.png', { 
                    caption: finalCaption,
                    parse_mode: 'Markdown'
                });
                
                fs.writeFileSync('state.json', JSON.stringify({ last_signal: sinyalMesaji }));
                console.log("Yeni sinyal Telegram'a iletildi.");
            } else {
                console.log("Sinyal aynı, bildirim gönderilmedi.");
            }
        } else {
            console.log("Aktif Alış/Satış sinyali bulunamadı.");
        }
    } catch (err) {
        console.error("Hata:", err.message);
    } finally {
        await browser.close();
    }
}
run();
