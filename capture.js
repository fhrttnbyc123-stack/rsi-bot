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
    
    const chartUrl = `https://tr.tradingview.com/chart/We6vJ4le/?t=${Date.now()}&nosync=true`; 
    const isManualRun = (eventName === 'workflow_dispatch');
    const trHour = (new Date().getUTCHours() + 3) % 24;
    const isDailyReportTime = (trHour === 18);

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
        console.log("Grafiğe giriş yapılıyor...");
        await page.goto(chartUrl, { waitUntil: 'load', timeout: 150000 });
        
        console.log("WebSocket uyandırılıyor...");
        await page.mouse.click(500, 500); 
        await page.keyboard.press('Space');
        
        await new Promise(r => setTimeout(r, 90000)); 

        await page.addStyleTag({ 
            content: `[class*="layout__area--right"], [class*="widgetbar"] { display: none !important; }
                      .pane-legend, [class*="table"] { filter: invert(100%) contrast(200%) !important; }`
        });

        await page.evaluate(() => { document.body.style.zoom = "150%"; });
        await new Promise(r => setTimeout(r, 5000));

        const clipArea = { x: 1310, y: 0, width: 450, height: 950 };
        await page.screenshot({ path: 'tablo.png', clip: clipArea });

        console.log("OCR Analizi yapılıyor...");
        const result = await Tesseract.recognize('tablo.png', 'tur+eng');
        const lines = result.data.text.split('\n');
        
        // --- YENİ MANTIK: Sembol bazlı durum takibi ---
        let currentSnapshot = {}; // O anki durumu sembol:durum olarak tutacağız
        let fullReportList = [];  // 18:00 raporu için tüm listeyi tutacağız
        
        for (let line of lines) {
            if (!line || line.trim().length < 5) continue;
            let lowerLine = line.toLowerCase();
            let words = line.trim().split(/\s+/);
            
            // Sembol bulma (Akıllı yöntem)
            let symbol = "";
            let colonWord = words.find(w => w.includes(':'));
            if (colonWord) {
                symbol = colonWord;
            } else {
                if (words[0].includes('.') && words.length > 1) symbol = words[1];
                else symbol = words[0];
            }
            // Markdown hatasını önle
            let safeSymbol = symbol.replace(/_/g, '\\_'); 
            // JSON key olarak kullanmak için temiz sembol
            let rawSymbol = symbol.replace(/\\/g, ''); 

            if (rawSymbol.length < 3) continue;

            let status = "NÖTR"; // Varsayılan
            let emoji = "";

            if ((lowerLine.includes("kademel") || lowerLine.includes("ademel")) && 
                (lowerLine.includes("alis") || lowerLine.includes("alıs") || lowerLine.includes("alış"))) {
                status = "ALIŞ";
                emoji = "🟢";
            } else if (lowerLine.includes("kar") && 
                       (lowerLine.includes("satis") || lowerLine.includes("satıs") || lowerLine.includes("satış"))) {
                status = "SATIŞ";
                emoji = "🔴";
            } else if (lowerLine.includes("tetik") || lowerLine.includes("hazir")) {
                status = "TETİK";
                emoji = "🟠";
            } else if (lowerLine.includes("dikkat")) {
                status = "DİKKAT";
                emoji = "🟡";
            }

            // Anlık durumu kaydet (Karşılaştırma için)
            if (status !== "NÖTR") {
                currentSnapshot[rawSymbol] = status;
                fullReportList.push(`${emoji} ${safeSymbol}: ${status}`);
            }
        }

        fullReportList.sort();
        const fullReportText = fullReportList.join('\n');

        // --- GEÇMİŞ DURUMU YÜKLE ---
        let lastSnapshot = {};
        if (fs.existsSync('state.json')) {
            try {
                // Eğer dosya eskiyse (string tutuyorsa) patlamasın diye try-catch
                let content = JSON.parse(fs.readFileSync('state.json'));
                if (content.snapshot) {
                    lastSnapshot = content.snapshot;
                }
            } catch (e) { console.log("Eski state dosyası sıfırlandı."); }
        }

        // --- DEĞİŞİKLİK KONTROLÜ (Sadece ALIM/SATIM Bildir) ---
        let notificationLines = [];

        // Mevcut tablodaki her sembolü kontrol et
        for (let [sym, currentStatus] of Object.entries(currentSnapshot)) {
            let previousStatus = lastSnapshot[sym] || "NÖTR"; // Eskiden yoksa Nötr kabul et

            // Eğer durum değişmişse VE (Yeni durum ALIŞ veya SATIŞ ise)
            if (currentStatus !== previousStatus) {
                if (currentStatus === "ALIŞ") {
                    notificationLines.push(`🟢 ${sym.replace(/_/g, '\\_')}: KADEMELİ ALIŞ FIRSATI!`);
                } 
                else if (currentStatus === "SATIŞ") {
                    notificationLines.push(`🔴 ${sym.replace(/_/g, '\\_')}: KAR SATIŞI ZAMANI!`);
                }
                // NOT: "TETİK", "DİKKAT" veya "NÖTR"e geçişleri bilerek listeye eklemiyoruz.
            }
        }

        const timestampText = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

        // SENARYO 1: ÖNEMLİ DEĞİŞİKLİK VARSA BİLDİR
        if (notificationLines.length > 0) {
            let message = `🚨 **KRİTİK SİNYAL DEĞİŞİMİ** (${timestampText})\n\n` + notificationLines.join('\n');
            await bot.sendPhoto(chatId, 'tablo.png', { caption: message, parse_mode: 'Markdown' });
            console.log("Kritik değişiklik (Alış/Satış) bildirildi.");
        }
        
        // SENARYO 2: 18.00 RAPORU veya MANUEL RUN
        else if (isManualRun || isDailyReportTime) {
            const baslik = isManualRun ? "🔄 Manuel Kontrol" : "🕒 Günlük 18.00 Raporu";
            const durumMetni = fullReportText ? fullReportText : "Şu an listede aktif sinyal yok.";
            
            await bot.sendPhoto(chatId, 'tablo.png', { 
                caption: `${baslik} (${timestampText})\n\n${durumMetni}`,
                parse_mode: 'Markdown'
            });
            console.log("Rutin rapor gönderildi.");
        } else {
            console.log("Kritik bir değişim (Alış/Satış) yok, bildirim gönderilmedi.");
        }

        // --- YENİ DURUMU KAYDET (Her zaman güncelle ki bir sonraki saat referans olsun) ---
        fs.writeFileSync('state.json', JSON.stringify({ snapshot: currentSnapshot }));

    } catch (err) {
        console.error("Hata:", err.message);
        if (isManualRun) await bot.sendMessage(chatId, "❌ HATA: " + err.message);
    } finally {
        await browser.close();
    }
}
run();
