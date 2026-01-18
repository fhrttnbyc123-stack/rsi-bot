import json
import requests

STATE_FILE = "state.json"
TELEGRAM_TOKEN = "BOT_TOKEN_YAZ"
CHAT_ID = "CHAT_ID_YAZ"

# BURASI OCR / GÖRSELDEN GELECEK
# ŞİMDİLİK TEST
RSI_DATA = {
    "XU100": [38, 41],      # prev, current
    "XAGUSD": [72, 69],
    "NASDAQ": [45, 46]
}

def load_state():
    try:
        with open(STATE_FILE, "r") as f:
            return json.load(f)
    except:
        return {}

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

def send_telegram(msg):
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    requests.post(url, data={"chat_id": CHAT_ID, "text": msg})

def main():
    state = load_state()
    messages = []

    for symbol, (rsi_prev, rsi) in RSI_DATA.items():

        if symbol not in state:
            state[symbol] = {
                "watchLow": False,
                "watchHigh": False,
                "lastSignal": "NONE"
            }

        s = state[symbol]

        # --- WATCH DURUMLARI ---
        if rsi < 40:
            s["watchLow"] = True

        if rsi > 70:
            s["watchHigh"] = True

        # --- ALIM TETİĞİ ---
        buyTurn = s["watchLow"] and (rsi > rsi_prev)

        if buyTurn and s["lastSignal"] != "BUY":
            messages.append(
                f"🔔 Kademeli Alış Yap\n{symbol}\nRSI: {rsi}"
            )
            s["lastSignal"] = "BUY"
            s["watchLow"] = False

        # --- SATIŞ TETİĞİ ---
        sellTurn = s["watchHigh"] and (rsi_prev > 70 and rsi <= 70)

        if sellTurn and s["lastSignal"] != "SELL":
            messages.append(
                f"🔔 Kar Satışı Yap\n{symbol}\nRSI: {rsi}"
            )
            s["lastSignal"] = "SELL"
            s["watchHigh"] = False

        # --- NÖTR RESET ---
        if 40 <= rsi <= 70:
            if s["lastSignal"] != "NONE":
                s["lastSignal"] = "NONE"

    if messages:
        send_telegram("🚨 RSI SİNYAL\n\n" + "\n\n".join(messages))

    save_state(state)

if __name__ == "__main__":
    main()
