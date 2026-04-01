import os
import json
import time
from datetime import datetime, date
import pytz
import telebot
import yfinance as yf
import pandas as pd

try:
    from tradingview_ta import TA_Handler, Interval
    TV_AVAILABLE = True
except ImportError:
    TV_AVAILABLE = False

# ── Ortam Değişkenleri ────────────────────────────────────────────────────────
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_TOKEN")
CHAT_ID = os.environ.get("CHAT_ID")
bot = telebot.TeleBot(TELEGRAM_TOKEN)
TR_TZ = pytz.timezone("Europe/Istanbul")
CACHE_FILE = "signal_cache.json"

# ── Sembol Listesi (27 adet) ──────────────────────────────────────────────────
SYMBOLS = [
    # Commodities
    {"sym": "XAUUSD",  "tv_exch": "OANDA",   "tv_scr": "cfd",      "yf": "XAUUSD=X",    "label": "Altın"},
    {"sym": "XAGUSD",  "tv_exch": "OANDA",   "tv_scr": "cfd",      "yf": "SI=F",    "label": "Gümüş"},
    {"sym": "UKOIL",   "tv_exch": "TVC",     "tv_scr": "cfd",      "yf": "BZ=F",         "label": "Brent Petrol"},
    # Crypto
    {"sym": "BTCUSD",  "tv_exch": "BINANCE", "tv_scr": "crypto",   "yf": "BTC-USD",      "label": "Bitcoin"},
    {"sym": "ETHUSD",  "tv_exch": "BINANCE", "tv_scr": "crypto",   "yf": "ETH-USD",      "label": "Ethereum"},
    # Global Indices
    {"sym": "SPX",     "tv_exch": "SP",      "tv_scr": "america",  "yf": "^GSPC",        "label": "S&P 500"},
    {"sym": "NDX",     "tv_exch": "NASDAQ",  "tv_scr": "america",  "yf": "^IXIC",        "label": "Nasdaq 100"},
    {"sym": "DAX",     "tv_exch": "XETR",    "tv_scr": "indices",  "yf": "^GDAXI",       "label": "DAX"},
    {"sym": "SX5E",    "tv_exch": "TVC",     "tv_scr": "indices",  "yf": "^STOXX50E",    "label": "Euro Stoxx 50"},
    {"sym": "S5HLTH",  "tv_exch": "SP",      "tv_scr": "america",  "yf": "^SP500-35",    "label": "S&P Sağlık"},
    {"sym": "SPESG",   "tv_exch": "CBOE",    "tv_scr": "indices",  "yf": "^SPXESUP",     "label": "S&P ESG"},
    {"sym": "NTTR",    "tv_exch": "NASDAQ",  "tv_scr": "indices",  "yf": "^NDXT",        "label": "Nasdaq TR"},
    {"sym": "RSBLCNN", "tv_exch": "NASDAQ",  "tv_scr": "indices",  "yf": "BLCN",         "label": "Blockchain"},
    {"sym": "NQROBO",  "tv_exch": "NASDAQ",  "tv_scr": "indices",  "yf": "ROBO",         "label": "Robotik"},
    # BIST
    {"sym": "XU100",   "tv_exch": "BIST",    "tv_scr": "turkey",   "yf": "XU100.IS",     "label": "BIST 100"},
    {"sym": "XU030",   "tv_exch": "BIST",    "tv_scr": "turkey",   "yf": "XU030.IS",     "label": "BIST 30"},
    {"sym": "XBANK",   "tv_exch": "BIST",    "tv_scr": "turkey",   "yf": "XBANK.IS",     "label": "Banka"},
    {"sym": "XTUMY",   "tv_exch": "BIST",    "tv_scr": "turkey",   "yf": "XTUMY.IS",     "label": "Tüm Yıldızlar"},
    {"sym": "XTKJS",   "tv_exch": "BIST",    "tv_scr": "turkey",   "yf": "XTKJS.IS",     "label": "Teknoloji"},
    {"sym": "XGIDA",   "tv_exch": "BIST",    "tv_scr": "turkey",   "yf": "XGIDA.IS",     "label": "Gıda"},
    {"sym": "XHOLD",   "tv_exch": "BIST",    "tv_scr": "turkey",   "yf": "XHOLD.IS",     "label": "Holding"},
    {"sym": "XILTM",   "tv_exch": "BIST",    "tv_scr": "turkey",   "yf": "XILTM.IS",     "label": "Sanayi"},
]

# ── Fon-Endeks Haritası ───────────────────────────────────────────────────────
FUND_MAP = {
    "XAUUSD": [
        {"kod": "KZL", "ad": "Kuveyt Türk Altın Katılım",       "puan": 85.3, "katilim": True},
        {"kod": "MKG", "ad": "Aktif Portföy Altın Katılım",     "puan": 83.3, "katilim": True},
    ],
    "XAGUSD": [
        {"kod": "MJG", "ad": "Aktif Gümüş Fon Sepeti",          "puan": 75.7, "katilim": False},
        {"kod": "KGM", "ad": "Kuveyt Türk Gümüş Katılım",       "puan": 74.1, "katilim": True},
    ],
    "UKOIL": [
        {"kod": "EVM", "ad": "Deniz Enerji ve Madencilik",       "puan": 76.8, "katilim": False},
        {"kod": "KNJ", "ad": "Kuveyt Türk Enerji Katılım",      "puan": 59.2, "katilim": True},
    ],
    "BTCUSD": [
        {"kod": "ZFB", "ad": "Ak Fintek ve Blokzinciri",         "puan": 70.7, "katilim": False},
        {"kod": "YZC", "ad": "Yapı Kredi Fintech",               "puan": 58.2, "katilim": False},
    ],
    "ETHUSD": [
        {"kod": "ZFB", "ad": "Ak Fintek ve Blokzinciri",         "puan": 70.7, "katilim": False},
    ],
    "SPX": [
        {"kod": "KHA", "ad": "Pardus İkinci Hisse Yoğun",        "puan": 93.7, "katilim": False},
        {"kod": "BIH", "ad": "Pardus Birinci Hisse Yoğun",       "puan": 90.6, "katilim": False},
    ],
    "NDX": [
        {"kod": "YHZ", "ad": "Yapı Kredi BIST Teknoloji",        "puan": 78.2, "katilim": False},
        {"kod": "ICZ", "ad": "Ak Teknoloji Şirketleri",          "puan": 68.2, "katilim": False},
    ],
    "DAX": [
        {"kod": "KHA", "ad": "Pardus İkinci Hisse Yoğun",        "puan": 93.7, "katilim": False},
    ],
    "SX5E": [
        {"kod": "KHA", "ad": "Pardus İkinci Hisse Yoğun",        "puan": 93.7, "katilim": False},
    ],
    "S5HLTH": [
        {"kod": "IKL", "ad": "İş Sağlık Şirketleri Karma",       "puan": 49.6, "katilim": False},
    ],
    "SPESG": [
        {"kod": "SUR", "ad": "Emaa Blue Sürdürülebilirlik",      "puan": 65.1, "katilim": False},
    ],
    "NTTR": [
        {"kod": "YHZ", "ad": "Yapı Kredi BIST Teknoloji",        "puan": 78.2, "katilim": False},
    ],
    "RSBLCNN": [
        {"kod": "ZFB", "ad": "Ak Fintek ve Blokzinciri",         "puan": 70.7, "katilim": False},
    ],
    "NQROBO": [
        {"kod": "GPT", "ad": "Aktif Robotik Teknolojileri",      "puan": 70.6, "katilim": False},
        {"kod": "YJK", "ad": "Yapı Kredi Robotik",               "puan": 67.3, "katilim": False},
    ],
    "XU100": [
        {"kod": "HRZ", "ad": "Aktif BIST Halka Arz Hisse",       "puan": 82.5, "katilim": False},
        {"kod": "MMH", "ad": "Aktif BIST 30 Endeks Hisse",       "puan": 61.6, "katilim": False},
    ],
    "XU030": [
        {"kod": "MMH", "ad": "Aktif BIST 30 Endeks Hisse",       "puan": 61.6, "katilim": False},
    ],
    "XBANK": [
        {"kod": "YZH", "ad": "TEB BIST Banka Endeksi",           "puan": 61.5, "katilim": False},
        {"kod": "TAU", "ad": "İş BIST Banka Endeksi",            "puan": 60.9, "katilim": False},
    ],
    "XTUMY": [
        {"kod": "KHA", "ad": "Pardus İkinci Hisse Yoğun",        "puan": 93.7, "katilim": False},
    ],
    "XTKJS": [
        {"kod": "YHZ", "ad": "Yapı Kredi BIST Teknoloji",        "puan": 78.2, "katilim": False},
    ],
    "XGIDA": [
        {"kod": "TVE", "ad": "Emaa Blue Tarım Gıda Katılım",     "puan": 62.5, "katilim": True},
        {"kod": "YTV", "ad": "Yapı Kredi Tarım Değişken",        "puan": 49.5, "katilim": False},
    ],
    "XHOLD": [
        {"kod": "HVI", "ad": "Deniz Holdingler ve İştirakler",   "puan": 61.5, "katilim": False},
    ],
    "XILTM": [
        {"kod": "BSN", "ad": "Bulls Sanayi Hisse Serbest",       "puan": 80.2, "katilim": False},
        {"kod": "PSR", "ad": "Pardus Sanayi Hisse Serbest",      "puan": 79.9, "katilim": False},
    ],
}

# ── Sinyal Türleri ────────────────────────────────────────────────────────────
SIG_BUY      = "BUY"       # 🟢 AL FIRSATI — acil
SIG_SELL     = "SELL"      # 🔴 KAR AL — acil
SIG_ENTERING = "ENTERING"  # 🔵 ALIM BÖLGESİNE GİRDİ — özet
SIG_WATCHOUT = "WATCHOUT"  # 🟠 TETİKTE OL — özet
SIG_OVERSOLD = "OVERSOLD"  # ❄️ AŞIRI SATIM — bilgi (özete dahil)
SIG_OVERBOUGHT = "OVERBOUGHT"  # 🔥 ZİRVEDE — bilgi (özete dahil)
SIG_NEUTRAL  = None


# ── Cache Yönetimi ────────────────────────────────────────────────────────────
def load_cache() -> dict:
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            today = date.today().isoformat()
            if data.get("date") != today:
                return {"date": today, "signals": []}
            return data
        except Exception:
            pass
    return {"date": date.today().isoformat(), "signals": []}


def save_cache(cache: dict):
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)


def already_sent(cache: dict, sym: str, sig_type: str) -> bool:
    key = f"{sym}:{sig_type}"
    return key in cache.get("signals", [])


def mark_sent(cache: dict, sym: str, sig_type: str):
    key = f"{sym}:{sig_type}"
    if key not in cache["signals"]:
        cache["signals"].append(key)


# ── RSI Hesaplama (Wilder's RMA, TradingView uyumlu) ─────────────────────────
def calculate_tv_rsi(prices: pd.Series, period: int = 14) -> pd.Series:
    delta = prices.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


# ── Veri Kaynağı: Hybrid (TV → YF fallback) ──────────────────────────────────
def get_rsi_from_yf(ticker: str):
    try:
        df = yf.download(ticker, period="1y", interval="1d", progress=False)
        if df.empty or len(df) < 50:
            return None, None
        close = df["Close"]
        if hasattr(close, "squeeze"):
            close = close.squeeze()
        rsi = calculate_tv_rsi(close)
        if rsi is None or len(rsi) < 2:
            return None, None
        return float(rsi.iloc[-1]), float(rsi.iloc[-2])
    except Exception:
        return None, None


def get_rsi(config: dict):
    if TV_AVAILABLE:
        try:
            handler = TA_Handler(
                symbol=config["sym"],
                exchange=config["tv_exch"],
                screener=config["tv_scr"],
                interval=Interval.INTERVAL_1_DAY,
                timeout=12,
            )
            analysis = handler.get_analysis()
            curr = analysis.indicators.get("RSI")
            prev = analysis.indicators.get("RSI[1]")
            if curr is not None:
                return float(curr), float(prev) if prev is not None else None
        except Exception:
            pass
    return get_rsi_from_yf(config["yf"])


# ── Sinyal Tespiti ────────────────────────────────────────────────────────────
def detect_signal(curr: float, prev: float):
    """TradingView ile birebir aynı sinyal mantığı."""
    if prev is None:
        if curr < 30:
            return SIG_OVERSOLD
        if curr >= 70:
            return SIG_OVERBOUGHT
        return SIG_NEUTRAL

    # Acil sinyaller
    if prev <= 40 and curr > prev and curr > 40:
        return SIG_BUY
    if prev >= 70 and curr < 70:
        return SIG_SELL

    # Özet sinyaller
    if prev >= 40 and curr < 40:
        return SIG_ENTERING
    if prev >= 70 and curr < prev:
        return SIG_WATCHOUT

    # Bilgi
    if curr < 30:
        return SIG_OVERSOLD
    if curr >= 70:
        return SIG_OVERBOUGHT

    return SIG_NEUTRAL


# ── Mesaj Formatları ──────────────────────────────────────────────────────────
def _fund_lines(sym: str) -> str:
    funds = FUND_MAP.get(sym, [])
    if not funds:
        return ""
    lines = ["\n📋 *En İyi Fonlar:*"]
    for i, f in enumerate(funds[:2]):
        katilim = " ☪️" if f["katilim"] else ""
        prefix = "  ⭐" if i == 0 else "    "
        lines.append(f"{prefix} `{f['kod']}` — {f['ad']} ({f['puan']} puan){katilim}")
    return "\n".join(lines)


def build_buy_message(sym: str, label: str, curr: float, prev: float) -> str:
    funds = _fund_lines(sym)
    msg = (
        f"🟢 *AL FIRSATI — {sym}* ({label})\n"
        f"━━━━━━━━━━━━━━━━━━━\n"
        f"RSI: `{prev:.1f}` ➔ `{curr:.1f}` (40 üzerine çıktı)"
    )
    if funds:
        msg += funds
        msg += "\n\n💡 _Uygulamayı aç ve yukarıdaki fonu al._"
    return msg


def build_sell_message(sym: str, label: str, curr: float, prev: float) -> str:
    return (
        f"🔴 *KAR AL — {sym}* ({label})\n"
        f"━━━━━━━━━━━━━━━━━━━\n"
        f"RSI: `{prev:.1f}` ➔ `{curr:.1f}` (70 altına düştü)\n\n"
        f"💡 _Bu endekse bağlı fonlarını kontrol et ve kar realizasyonu değerlendir._"
    )


def build_daily_summary(
    now_tr: datetime,
    urgent: list,       # [(sym, label, sig, curr)]
    watchlist: list,    # [(sym, label, sig, curr)]
) -> str:
    date_str = now_tr.strftime("%d.%m.%Y")
    msg = f"📊 *GÜNLÜK ÖZET* — {date_str} 18:00\n━━━━━━━━━━━━━━━━━━━\n"

    if urgent:
        msg += "\n🚨 *ACİL AKSİYON:*\n"
        for sym, label, sig, curr in urgent:
            icon = "🟢" if sig == SIG_BUY else "🔴"
            msg += f"  {icon} `{sym}` ({label}) — RSI: {curr:.1f}\n"

    if watchlist:
        msg += "\n⚡ *TAKİPTE TUT:*\n"
        for sym, label, sig, curr in watchlist:
            if sig == SIG_ENTERING:
                icon = "🔵"
            elif sig == SIG_WATCHOUT:
                icon = "🟠"
            elif sig == SIG_OVERSOLD:
                icon = "❄️"
            else:
                icon = "🔥"
            msg += f"  {icon} `{sym}` ({label}) — RSI: {curr:.1f}\n"

    return msg.strip()


def build_no_action_message(now_tr: datetime) -> str:
    return (
        f"✅ *Kontrol tamamlandı* — {now_tr.strftime('%H:%M')}\n"
        f"_Bugün aksiyon gerektiren sinyal yok. Rahat ol._"
    )


# ── Ana Fonksiyon ─────────────────────────────────────────────────────────────
def run():
    now_tr = datetime.now(TR_TZ)
    is_report_time = (now_tr.hour == 18 and now_tr.minute < 16)

    cache = load_cache()

    urgent_signals   = []  # acil (BUY / SELL)
    summary_signals  = []  # özete dahil (ENTERING / WATCHOUT / OVERSOLD / OVERBOUGHT)

    for item in SYMBOLS:
        sym = item["sym"]
        label = item["label"]

        try:
            curr, prev = get_rsi(item)
        except Exception:
            curr, prev = None, None

        if curr is None or (isinstance(curr, float) and pd.isna(curr)):
            time.sleep(0.8)
            continue

        sig = detect_signal(curr, prev if prev is not None else curr)

        # ── Acil bildirimler (BUY / SELL) ─────────────────────────────────────
        if sig in (SIG_BUY, SIG_SELL):
            if not already_sent(cache, sym, sig):
                try:
                    if sig == SIG_BUY:
                        msg = build_buy_message(sym, label, curr, prev)
                    else:
                        msg = build_sell_message(sym, label, curr, prev)
                    bot.send_message(CHAT_ID, msg, parse_mode="Markdown")
                    mark_sent(cache, sym, sig)
                    save_cache(cache)
                except Exception as e:
                    print(f"[WARN] Telegram gönderim hatası ({sym}): {e}")
            urgent_signals.append((sym, label, sig, curr))

        # ── Özet sinyaller ────────────────────────────────────────────────────
        elif sig in (SIG_ENTERING, SIG_WATCHOUT, SIG_OVERSOLD, SIG_OVERBOUGHT):
            summary_signals.append((sym, label, sig, curr))

        time.sleep(0.8)

    # ── 18:00 Günlük Özet ─────────────────────────────────────────────────────
    if is_report_time:
        has_action = bool(urgent_signals or summary_signals)
        if has_action:
            msg = build_daily_summary(now_tr, urgent_signals, summary_signals)
        else:
            msg = build_no_action_message(now_tr)
        try:
            bot.send_message(CHAT_ID, msg, parse_mode="Markdown")
        except Exception as e:
            print(f"[WARN] Günlük özet gönderim hatası: {e}")


if __name__ == "__main__":
    run()
