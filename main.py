from tradingview_ta import TA_Handler, Interval

symbols = [
    ("THYAO", "BIST"),
    ("ASELS", "BIST"),
    ("SISE", "BIST"),
]

for symbol, exchange in symbols:
    try:
        handler = TA_Handler(
            symbol=symbol,
            exchange=exchange,
            screener="turkey",
            interval=Interval.INTERVAL_1_DAY
        )

        analysis = handler.get_analysis()
        rsi = analysis.indicators["RSI"]

        print(f"{symbol} RSI: {round(rsi,2)}")

    except Exception as e:
        print(f"{symbol} hata: {e}")
