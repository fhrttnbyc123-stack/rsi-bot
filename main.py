from tradingview_ta import TA_Handler, Interval, Exchange

symbols = [
    ("RSBLCNN", "BIST"),
    ("NTTR", "BIST"),
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

        print(f"{symbol} RSI: {rsi}")

    except Exception as e:
        print(f"{symbol} hata: {e}")
