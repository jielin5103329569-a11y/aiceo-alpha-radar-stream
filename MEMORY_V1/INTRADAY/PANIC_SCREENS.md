# Panic-dip intraday screens (draft)
Owner asked 2026-09-20. Not implemented. Not live-5. Not bottleneck wells.

Universe (scope before layers)
Start wide on liquid US common stock only, then shrink.
In:
- NYSE / Nasdaq common shares in regular session
- Enough 20-day dollar volume to trade in and out same day without becoming the print
- Price high enough that a normal spread does not eat the bounce
Out of the starting bag:
- OTC, warrants, most 1-dollar names, new IPO week ones
- Bottleneck well list and the 7 mirror names are not the bag
- live-5 is not the bag
Daily run order:
1) liquid universe
2) today losers vs prior close / open (percent and speed)
3) Layers 2-3 kill the terminal names
4) Layer 4 tape keeps 1-3 names max
Do not scan the whole market tick-by-tick. Rank losers first, then apply layers.

Levels
- Daily 20/50: context only.
- Session VWAP: main ruler for extension and reclaim.
- 5-minute 9/20: hold-after-reclaim only. Not a cross signal.
- Do not use 1-minute MA as a signal.

Kill: panic inside a downtrend
- If the name is already in a daily downtrend (below daily 20/50, series of lower highs), do not treat a new flush as this setup.
- This strategy wants a shock flush in an otherwise tradeable tape, not the next leg of a slide.

News
- Veto layer only. Not an entry trigger.
- Use a headline to pass or kill Layer 3.
- Do not wait for a full news cycle. Do not buy because a headline is loud.

Layer 1 Liquidity
- US listed. Price and average dollar volume high enough to enter and exit same day.
- Spread tight vs expected bounce.
- Not a halt magnet / not a 1-dollar story stock unless Owner later allows.

Layer 2 Isolate the fear
- Drop is stock-specific or small-group, not the whole index melting.
- If SPY/QQQ is also vertical down, skip or half-size. Panic-dip needs a bounce path.
- Prefer one clean headline over a stack of unknown lawsuits.

Layer 3 Why it fell
Pass examples: crowded unwind, headline worse than text, sector sympathy, stop-run after open.
Fail examples: going-concern, fraud, halt pending, offering priced, guidance gutted for years.
Fear without a reason is not a setup. Fear with a terminal reason is not a dip.

Layer 4 Tape
- Fast extension from morning VWAP / prior close.
- Volume spike then stall, not a quiet grind to new lows.
- First reclaim of a morning flush level beats catching the knife mid-fall.

Layer 5 Time
- First 30-90 minutes: only if flush already printed.
- Midday: only if range is dead and you are not inventing a bounce.
- Last hour: only if already in and managing; new entries need a higher bar.

Layer 6 Size and kill
- Size vs average volume so exit does not become the event.
- Hard invalidation: new low after the reclaim fails.
- Time stop: thesis not working into the close, flatten.
- No add to a loser.

Out of this strategy
- Bottleneck well names are not auto-included.
- Three-cell hit-rate does not pick these names.
- Semi-auto off until Owner starts this track and Triad is explicit.
