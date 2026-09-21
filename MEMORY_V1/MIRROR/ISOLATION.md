# Mirror isolation (Owner 2026-09-20)

Bottleneck radar is a latent model. Not day-trading.

Two machines stay separate:

A. Live monitor (existing Databento / live-5 / 8080)
- Do not break.
- Do not feed bottleneck wells.
- Do not feed PAIRINGS as a stream.

B. Bottleneck + Eyes + Mirror compare
- Input: frozen PACK + well card + snapshot checkpoints.
- Price: on-demand last print or daily close at T0 / +1d / +5d / +20d / milestone date.
- Output: hit-rate of named shells vs later price and later reality.
- Forbidden: realtime tick ingest, semi-auto trade, alertReady from wells, pack rewrite.

PAIRINGS.yaml is checkpoint table, not a live tape.
GET /research/pairings stays read-only.
Mirror universe (BE NVDA GOOGL GEV GNRC AMZN NEE) is compare sample only, not live-5.
