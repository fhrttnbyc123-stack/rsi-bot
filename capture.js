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
    
    // =================================================================
    // DİKKAT: AŞAĞIDAKİ 'We6vJ4le' YERİNE KENDİ GRAFİK ID'Nİ YAZ!
    // URL Şöyledir: https://tr.tradingview.com/chart/XYZ123/ -> ID: XYZ123
    // =================================================================
    const chartId = 'cZaSxzAT'; 
    // =================================================================

    const chartUrl = `https://tr.tradingview.com/chart/${chartId}/?t=${Date.now()}&nosync=true`; 
    
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
        
        // Tablonun yüklenmesi için bekleme süresi
        await new Promise(r => setTimeout(r, 60000)); 

        // Yan paneli kapat ve renkleri ters çevir (OCR için)
        await page.addStyleTag({ 
            content: `[class*="layout__area--right"], [class*="widgetbar"] { display: none !important; }
                      .pane-legend, [class*="table"] { filter: invert(100%) contrast(200%) !important; }`
        });

        await page.evaluate(() => { document.body.style.zoom = "150%"; });
        await new Promise(r => setTimeout(r, 5000));

        // Tabloyu fotoğrafla
        const clipArea = { x: 1310, y: 0, width: 450, height: 950 };
        await page.screenshot({ path: 'tablo.png', clip: clipArea });

        console.log("OCR Analizi yapılıyor...");
        const result = await Tesseract.recognize('tablo.png', 'tur+eng');
        const lines = result.data.text.split('\n');
        
        let currentSnapshot = {}; 
        let fullReportList = [];  
        
        for (let line of lines) {
            if (!line || line.trim().length < 5) continue;
            let lowerLine = line.toLowerCase();
            let words = line.trim().split(/\s+/);
            
            // Sembol yakalama
            let symbol = words[0]; 
            // Eğer sembol "1." gibi başlıyorsa ikinci kelimeyi al
            if (symbol.includes('.') || symbol.length < 2) {
                 if(words.length > 1) symbol = words[1];
            }
            
            let safeSymbol = symbol.replace(/_/g, '\\_'); 
            let rawSymbol = symbol.replace(/\\/g, ''); 

            let status = "NÖTR";
            let emoji = "";

            // --- YENİ İNDİKATÖR KELİMELERİ ---
            
            // 1. AL FIRSATI (Yeşil)
            if (lowerLine.includes("al") && (lowerLine.includes("firsat") || lowerLine.includes("fırsat"))) {
                status = "ALIŞ";
                emoji = "🟢";
            } 
            // 2. KAR AL (Kırmızı)
            else if (lowerLine.includes("kar") && lowerLine.includes("al")) {
                status = "SATIŞ";
                emoji = "🔴";
            } 
            // 3. TETİKTE OL
            else if (lowerLine.includes("tetik") || lowerLine.includes("hazir")) {
                status = "TETİK";
                emoji = "🟠";
            } 
            // 4. DİKKAT
            else if (lowerLine.includes("dikkat")) {
                status = "DİKKAT";
                emoji = "🟡";
            }
            // 5. ALIM BÖLGESİ
            else if (lowerLine.includes("alim") && lowerLine.includes("bolge")) {
                status = "ALIM BÖLGESİ";
                emoji = "🔵";
            }

            // Listeye Ekle
            if (status !== "NÖTR") {
                currentSnapshot[rawSymbol] = status;
                fullReportList.push(`${emoji} ${safeSymbol}: ${status}`);
            }
        }

        fullReportList.sort();
        const fullReportText = fullReportList.join('\n');

        // --- GEÇMİŞİ OKU ---
        let lastSnapshot = {};
        if (fs.existsSync('state.json')) {
            try {
                let content = JSON.parse(fs.readFileSync('state.json'));
                if (content.snapshot) lastSnapshot = content.snapshot;
            } catch (e) { console.log("State sıfırlandı."); }
        }

        // --- SADECE DEĞİŞİKLİKLERİ BİLDİR ---
        let notificationLines = [];

        for (let [sym, currentStatus] of Object.entries(currentSnapshot)) {
            let previousStatus = lastSnapshot[sym] || "NÖTR"; 

            // Eğer durum değiştiyse...
            if (currentStatus !== previousStatus) {
                // Sadece "ALIŞ" veya "SATIŞ" durumuna yeni geçildiyse alarm ver!
                if (currentStatus === "ALIŞ") {
                    notificationLines.push(`🟢 ${sym.replace(/_/g, '\\_')}: AL FIRSATI DOĞDU!`);
                } 
                else if (currentStatus === "SATIŞ") {
                    notificationLines.push(`🔴 ${sym.replace(/_/g, '\\_')}: KAR AL ZAMANI!`);
                }
                // Tetikte ol, Dikkat vb. değişimleri buraya eklemedik, onlar sessiz kalacak.
            }
        }

        const timestampText = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

        // MESAJ GÖNDERME KARARI
        if (notificationLines.length > 0) {
            // Önemli bir şey oldu
            let message = `🚨 **SİNYAL DEĞİŞİMİ** (${timestampText})\n\n` + notificationLines.join('\n');
            await bot.sendPhoto(chatId, 'tablo.png', { caption: message, parse_mode: 'Markdown' });
            console.log("Kritik değişiklik bildirildi.");
        }
        else if (isManualRun || isDailyReportTime) {
            // Rutin Rapor (18:00 veya Manuel)
            const baslik = isManualRun ? "🔄 Manuel Kontrol" : "🕒 Günlük 18.00 Raporu";
            const durumMetni = fullReportText ? fullReportText : "Listede aktif ana sinyal yok.";
            
            await bot.sendPhoto(chatId, 'tablo.png', { 
                caption: `${baslik} (${timestampText})\n\n${durumMetni}`,
                parse_mode: 'Markdown'
            });
            console.log("Rutin rapor gönderildi.");
        } else {
            console.log("Sessiz mod: Değişiklik yok.");
        }

        // Yeni durumu kaydet
        fs.writeFileSync('state.json', JSON.stringify({ snapshot: currentSnapshot }));

    } catch (err) {
        console.error("Hata:", err.message);
        if (isManualRun) await bot.sendMessage(chatId, "❌ HATA: " + err.message);
    } finally {
        await browser.close();
    }
}
run();
