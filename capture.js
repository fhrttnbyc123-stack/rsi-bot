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
    const chartUrl = 'https://tr.tradingview.com/chart/We6vJ4le/'; 

    // Türkiye Saati Hesapla
    const now = new Date();
    const trHour = (now.getUTCHours() + 3) % 24;
    const isDailyReportTime = (trHour === 18);
    const isManualRun = (eventName === 'workflow_dispatch');

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
        // Sayfayı önbelleği yok sayarak (cache-busting) yükle
        await page.goto(chartUrl, { waitUntil: 'networkidle2', timeout: 90000 });
        await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
        
        await new Promise(r => setTimeout(r, 45000));

        // OTURUM KONTROLÜ: Eğer giriş yapılmamışsa sağ üstteki profil ikonu çıkmaz
        const isLoggedIn = await page.evaluate(() => {
            return document.body.innerHTML.includes('header-user-menu') || !document.body.innerHTML.includes('Giriş yap');
        });

        if (!isLoggedIn) {
            await bot.sendMessage(chatId, "⚠️ UYARI: TradingView Oturumu Kapanmış! Lütfen SESSION_ID çerezlerini yenileyin.");
            return;
        }

        // Yan Paneli Kapat ve Görseli Filtrele
        await page.addStyleTag({ 
            content: `[class*="layout__area--right"], [class*="widgetbar"] { display: none !important; }
                      .pane-legend, [class*="table"] { filter: grayscale(100%) contrast(200%) brightness(150%) !important; }`
        });

        await page.evaluate(() => { document.body.style.zoom = "150%"; });
        await new Promise(r => setTimeout(r, 5000));

        // ALTIN ORAN KOORDİNATLARIN (Son belirlediğimiz)
        const clipArea = { x: 1310, y: 0, width: 450, height: 950 };
        await page.screenshot({ path: 'tablo.png', clip: clipArea });

        // MANUEL veya SAAT 18:00 ise FOTOĞRAF GÖNDER
        if (isManualRun || isDailyReportTime) {
            const caption = isManualRun ? "🔄 Manuel Kontrol Raporu" : "🕒 Günlük Saat 18.00 Özeti";
            await bot.sendPhoto(chatId, 'tablo.png', { caption: caption });
            console.log("Bilgilendirme fotoğrafı gönderildi.");
        }

        console.log("OCR Analizi yapılıyor...");
        const result = await Tesseract.recognize('tablo.png', 'tur+eng');
        const rawText = result.data.text;
        const lines = rawText.split('\n');
        
        let currentSignals = [];
        for (let line of lines) {
            let lowerLine = line.toLowerCase();
            let words = line.trim().split(/\s+/);
            let symbol = words[1] || words[0] || "Bilinmiyor"; // Sembol ismini çekmeye çalışır
            
            if ((lowerLine.includes("kademel") || lowerLine.includes("ademel")) && 
                (lowerLine.includes("alis") || lowerLine.includes("alıs") || lowerLine.includes("alış"))) {
                currentSignals.push(`🟢 ${symbol}: KADEMELİ ALIŞ`);
            } else if (lowerLine.includes("kar") && 
                       (lowerLine.includes("satis") || lowerLine.includes("satıs") || lowerLine.includes("satış"))) {
                currentSignals.push(`🔴 ${symbol}: KAR SATIŞI`);
            }
        }

        const signalText = currentSignals.join('\n');

        if (signalText !== "") {
            let state = { last_all_signals: "" };
            if (fs.existsSync('state.json')) {
                state = JSON.parse(fs.readFileSync('state.json'));
            }

            // Sadece değişiklik varsa veya manuel ise detaylı mesaj gönder
            if (state.last_all_signals !== signalText || isManualRun) {
                // Değişiklik mesajı (Fotoğraflı)
                if (!isManualRun && !isDailyReportTime) {
                    await bot.sendPhoto(chatId, 'tablo.png', { 
                        caption: `🚨 **STRATEJİ DEĞİŞİKLİĞİ** 🚨\n\n${signalText}`,
                        parse_mode: 'Markdown'
                    });
                } else {
                    // Manuel/Saatlik detay metni
                    await bot.sendMessage(chatId, `📊 **Güncel Sinyal Detayları:**\n\n${signalText}`);
                }
                
                fs.writeFileSync('state.json', JSON.stringify({ last_all_signals: signalText }));
                console.log("Sinyaller iletildi.");
            }
        } else {
            console.log("Aktif sinyal bulunamadı.");
        }
    } catch (err) {
        console.error("Hata:", err.message);
    } finally {
        await browser.close();
    }
}
run();
