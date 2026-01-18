import json
import requests
from datetime import datetime

STATE_FILE = "state.json"
TELEGRAM_TOKEN = "BOT_TOKEN_YAZ"
CHAT_ID = "CHAT_ID_YAZ"

# ÖRNEK: Görselden okunduğunu varsaydığımız RSI değerleri
# SEN BUNU OCR veya görsel yakalama ile dolduracaksın
RSI_DATA = {
    "XU100": 32,
    "DAX": 41,
    "NASDAQ": 73
}

def load_state():
    try:
        with open(STATE_FILE, "r") as f:
            return json.load(f)
    except:
        return {}

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)

def rsi_status(rsi):
    if rsi <= 35:
        return "AL"
    elif rsi >= 70:
        return "SAT"
    else:
        return "NONE"

def send_telegram(msg):
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    requests.post(url, data={"chat_id": CHAT_ID, "text": msg})

def main():
    state = load_state()
    messages = []

    for symbol, rsi in RSI_DATA.items():
        new_status = rsi_status(rsi)
        old_status = state.get(symbol, "NONE")

        if new_status != old_status:
            state[symbol] = new_status

            if new_status in ["AL", "SAT"]:
                messages.append(
                    f"{symbol}\nRSI: {rsi}\nSİNYAL: {new_status}"
                )

    if messages:
        send_telegram("🚨 RSI ALARM\n\n" + "\n\n".join(messages))

    save_state(state)

if __name__ == "__main__":
    main()

