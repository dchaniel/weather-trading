# Building an automated quantitative trading system for Kalshi

Kalshi represents a genuine frontier for quantitative traders: a CFTC-regulated prediction market exchange where binary event contracts on weather, economics, politics, sports, and financial indices trade on a central limit order book with full API access. The strongest edges exist in weather markets (where meteorological models outperform crowd pricing by 8%+ daily), economic data markets (where a 2026 Federal Reserve paper confirmed Kalshi beats Bloomberg consensus on CPI forecasting), and systematic exploitation of the well-documented favorite-longshot bias across all categories. However, thin liquidity outside sports, unsettled tax treatment, and rapid edge decay from institutional competitors like Susquehanna make this a challenging but tractable arena for a technically skilled builder willing to operate at the intersection of data science, domain modeling, and execution engineering.

-----

## How Kalshi's exchange actually works

Kalshi trades binary event contracts — Yes/No questions that pay $1.00 if the event occurs and $0.00 if it doesn't. Contract prices range from $0.01 to $0.99, with Yes + No always summing to $1.00 (a Yes contract at $0.70 implies a 70% market probability). All positions are fully collateralized — no margin, no credit risk to the exchange. The order book is a central limit order book (CLOB) with price-time priority, and Kalshi provides REST API, WebSocket streaming, and FIX protocol access for automated trading.

The exchange offers markets across sports (~90% of volume), financial indices (S&P 500 and NASDAQ-100 bracket contracts resolving every 15 minutes to annually), economics (CPI, Fed rate decisions, unemployment, GDP), weather (daily high temperatures in NYC, Chicago, Miami, Austin), politics, entertainment, and crypto. Sports dominate volume — $22.88 billion in total 2025 trading volume with 1,221% year-over-year growth — but the thinner non-sports markets present more exploitable inefficiencies.

The API architecture is well-designed for algorithmic trading. The production REST endpoint lives at https://api.elections.kalshi.com/trade-api/v2, with WebSocket streaming at the corresponding wss:// URL. Authentication uses RSA key pairs generating signatures over timestamp + method + path. Public market data endpoints (order books, trades, candlesticks) require no authentication, enabling frictionless market monitoring. Order placement supports limit orders, post-only orders, immediate-or-cancel, fill-or-kill, reduce-only, self-trade prevention, and batch operations (`BatchCreateOrders` handles multiple orders in one call). The official Python SDK (`kalshi-python` on PyPI) provides typed access to all endpoints.

Rate limits are tiered based on trading volume: Basic users get 20 reads/second and 10 writes/second. Advanced tier (application required) offers 30/30. Premier (3.75% of exchange volume monthly) gives 100/100. Prime (7.5% of volume) reaches 400 reads and writes per second. This makes true HFT impractical but medium-frequency strategies (seconds to minutes) entirely viable.

The fee structure uses a probability-weighted formula: fee = round_up(0.07 × contracts × P × (1-P)) for takers, where P is the contract price. This means fees peak at $0.02/contract at 50¢ prices and fall toward $0.01 at extreme prices. Maker fees, where applicable, use a 0.0175 coefficient. S&P 500 and NASDAQ-100 markets enjoy 50% reduced fees. Settlement is free, Kalshi pays 4% annual interest on cash balances, and ACH transfers are free.

-----

## Where the real edges exist: a ranked assessment

Not all Kalshi markets are created equal. Academic research, community experience, and structural analysis point to a clear hierarchy of opportunity.

Weather markets offer the highest edge potential. Daily temperature contracts resolve every day for four cities, creating rapid capital turnover and hundreds of trading opportunities per month. The key insight is that professional weather models (GFS ensembles, ECMWF, HRRR) produce calibrated probability distributions for temperature outcomes, while Kalshi's retail-heavy participant base prices contracts based on consumer weather apps or intuition. Multiple documented bots have exploited this gap — one GitHub project (suislanchez/polymarket-kalshi-weather-bot) routinely finds >8% edge between GFS ensemble probabilities and market prices. A weather bot turned $1,000 into $24,000 since April 2025 on temperature markets. The settlement source is the NWS Daily Climate Report, and understanding technical details like DST/LST conversion and METAR observation timing creates additional information advantages.

Economic data markets are the second-strongest opportunity. A landmark February 2026 Federal Reserve working paper (Diercks, Katz, and Wright) found that Kalshi achieved a "perfect forecast record" the day before every FOMC meeting since 2022, beating Fed funds futures. On headline CPI, Kalshi's mean absolute error was approximately 7 basis points versus approximately 8 for Bloomberg consensus — a statistically significant improvement. The paper also noted that thin liquidity means "prices that are noisy or easily moved by a small number of participants," which is precisely the opportunity for a well-calibrated econometric model. Cross-referencing Kalshi prices against Cleveland Fed inflation nowcasts, Atlanta Fed GDPNow, and CME FedWatch probabilities reveals actionable divergences. A February 2026 Wedbush analysis documented a 54% spread between Kalshi Fed rate cut pricing and CME FedWatch implied probabilities.

Financial index bracket markets (S&P 500, NASDAQ-100, Bitcoin) rank third. These contracts resolve at frequencies from 15 minutes to annually, and proper volatility modeling (using Cauchy or GARCH distributions rather than Gaussian assumptions) prices brackets more accurately than the crowd. A USC QuantSC project demonstrated 20.3% return in a single day of S&P 500 market making using Cauchy distribution modeling with inventory management. The reduced fee structure on index markets (0.035 coefficient vs 0.07) further improves economics.

The favorite-longshot bias is the most robustly documented structural edge. A January 2026 University College Dublin study of 300,000+ Kalshi contracts found that contracts priced below 10¢ lose over 60% of their money on average, while contracts above 50¢ earn small positive returns. Makers on favorites earned +1.9% per trade (not annualized). Takers lost approximately 32% on average versus 10% for makers. This bias persists across all categories — politics, entertainment, economics, crypto, and weather — and is driven by Kalshi's fee structure hitting low-probability contracts hardest, combined with behavioral overestimation of small probabilities.

Sports markets have the deepest liquidity but the narrowest exploitable edges, because institutional market makers (Susquehanna, DL Trading) compete aggressively. Edge in sports comes from data speed — publicly available game data arrives with 30–40 second delays, and traders who scrape beat reporter Twitter accounts, monitor offshore book lines, or access faster scoring feeds gain meaningful advantages.

-----

## Quantitative strategies that work on prediction markets

### Market making on thin order books

Market making on Kalshi involves continuously quoting both sides of a contract and earning the bid-ask spread. The Avellaneda-Stoikov model, adapted for binary settlement, forms the theoretical backbone: compute a reservation price based on your probability estimate and inventory position, then place symmetric quotes that skew toward reducing accumulated inventory. The critical adaptation for event contracts is that positions snap to $0 or $1 at settlement — unlike equities, you cannot hold through a drawdown. This means aggressive inventory reduction as expiration approaches is essential, and circuit breakers that cancel all quotes on rapid price movement prevent catastrophic one-sided accumulation.

Practical market making requires capital allocation across multiple simultaneous markets to generate meaningful returns. Community estimates suggest $5K–$25K across several markets can generate $200–$1,000 monthly with semi-automated strategies, while full automation at $25K–$100K targets $1,000–$5,000 monthly. The key challenge is fill frequency — one developer reported that with conservative risk configuration, "orders don't really get taken very frequently" and recommended deploying across dozens of markets to maintain activity.

### Statistical and cross-market arbitrage

Three forms of arbitrage operate on Kalshi. Intra-market arbitrage exploits moments when mutually exclusive outcomes within an event don't sum to $1.00. Cross-platform arbitrage between Kalshi and Polymarket was documented during the 2024 election, though average arbitrage windows have shrunk to 2.7 seconds (from 12.3 seconds in 2024), with 73% of profits captured by sub-100ms bots. Cross-asset arbitrage between Kalshi and traditional instruments (Fed funds futures, Treasury yields, S&P options) represents the most capital-efficient opportunity — institutional desks reportedly build "synthetic straddles" buying "No" on Kalshi rate contracts while going long interest-rate futures on CME, profiting from convergence.

A study of Polymarket documented $40 million in realized arbitrage profit through market rebalancing and combinatorial arbitrage across logically related contracts. Combinatorial arbitrage — where individual swing state markets sum to probabilities inconsistent with the national outcome market — transfers directly to Kalshi's multivariate event structure.

### Event-driven and model-based strategies

The highest-conviction strategy combines domain-specific models with Kalshi's real-time pricing. For economic markets, build nowcasting models that incorporate high-frequency indicators (weekly jobless claims, daily credit card spending, Google Trends proxies) and compare your probability distribution against the market's implied distribution. The Fed paper found Kalshi had 40.1% lower mean absolute error than consensus forecasts for inflation surprises — yet many individual markets remain mispriced relative to what a good model would predict, especially in the hours after new data releases.

For weather, ensemble model output from GFS (31 members), ECMWF, and HRRR produces well-calibrated probability distributions that systematically outperform market prices. The strategy is mechanical: run the ensemble, compute bracket probabilities, compare to market, trade when edge exceeds fee threshold plus margin of safety.

### Bayesian updating and Kelly sizing

Bayesian frameworks excel on prediction markets because new information arrives continuously and the target is an explicit probability. Lee and Moretti (2009, American Economic Review) validated that prediction market prices follow Bayesian updating from polls, with larger-sample polls causing larger price changes consistent with precision weighting.

The practical implementation maintains a prior distribution for each event, defines likelihood functions mapping new data to probability shifts, computes posterior updates continuously, and trades when the posterior diverges significantly from market price.

Position sizing follows the Kelly criterion adapted for binary contracts: f* = (bp - q) / b, where p is your estimated true probability, q = 1-p, and b = (1-market_price)/market_price. A critical practical refinement is using 0.25x to 0.5x fractional Kelly, because full Kelly creates a 33% probability of halving your bankroll before doubling it, and probability estimation errors compound this risk dramatically. For a contract priced at $0.60 where your model estimates 75% true probability, full Kelly recommends 37.5% of bankroll — fractional Kelly at 0.25x brings this to approximately 9.4%, a much more survivable position size.

-----

## The data sources that feed the machine

Building competitive models requires layering multiple data feeds. The architecture divides into five categories based on market type.

For economic markets, the essential feeds are the FRED API (765,000+ time series, free with API key, ~120 requests/minute), the Atlanta Fed GDPNow (accessible via FRED series GDPNOW, updated 6–7 times per quarter), the Cleveland Fed inflation nowcast (daily updates for CPI and PCE), and BLS release data via api.bls.gov. The Python library fredapi returns pandas DataFrames with vintage date support for point-in-time analysis — critical for avoiding look-ahead bias in backtesting. The ISM PMI requires subscription access through Bloomberg or Reuters but release timing is known in advance (first business day of each month).

For weather markets, layer three model sources: the GFS ensemble via Open-Meteo's free API (`open-meteo.com/v1/gfs`, no authentication needed, combines GFS + HRRR), the ECMWF via the ecmwf-opendata Python package (consistently the most accurate global model, approximately one day accuracy advantage over GFS), and the HRRR (3km resolution, hourly US-only runs, best for 0–18 hour forecasts). The Python package herbie provides streamlined access to all NWP model data. The NWS API (`api.weather.gov`) provides official US forecasts with no authentication and generous rate limits. For production systems, Tomorrow.io and Visual Crossing offer historical data and higher reliability than government APIs.

For news and sentiment, GDELT provides 7.5+ billion articles updated every 15 minutes, accessible free through Google BigQuery. FinBERT (`ProsusAI/finbert` on HuggingFace) outperforms generic sentiment models on financial text. NewsAPI covers 80,000+ sources but limits free tier to 100 requests/day. Google Trends via pytrends provides search interest proxies but is unreliable for production use due to aggressive rate limiting.

For sports, The Odds API (`the-odds-api.com`) offers pre-match and live odds from 40+ bookmakers starting at $20/month. Sportradar provides institutional-grade coverage across 80+ sports with a 30-day free trial. ESPN's undocumented API (`site.api.espn.com`) provides scores but can break without notice.

Kalshi's own data — order books, trades, candlesticks, and market metadata — is freely available through the public API without authentication. Historical data can be collected via the candlestick endpoint (up to 10,000 candles per request) and the prediction-market-backtesting project on GitHub maintains approximately 53 GB of historical trade data across Kalshi and Polymarket.

-----

## Technical architecture for implementation

The recommended tech stack centers on Python for its ecosystem dominance in both data science and Kalshi SDK availability. The official kalshi-python package (v2.1.4, Python ≥3.9) provides typed access to all REST and WebSocket endpoints. Alternative wrappers include kalshi-py (type-safe, rebuilt daily from the OpenAPI spec) and kalshi-python-unofficial (lightweight). For lower-latency execution, Go offers a full client at github.com/ammario/kalshi.

For backtesting, two purpose-built frameworks exist for prediction markets — a critical distinction from equity backtesting tools that assume continuous price series. PredictionMarketBench provides deterministic event-driven replay of historical limit-order-book data with maker/taker fee modeling, supporting both classical strategies and LLM-based agents. The prediction-market-backtesting project on GitHub offers a NautilusTrader-inspired engine that replays historical trades chronologically with portfolio tracking and market lifecycle events across a 53 GB dataset. For custom needs, the QuantSC project demonstrates building a simulator that interleaves bot orders with historical trade data using PostgreSQL storage.

The execution layer should maintain persistent WebSocket connections for real-time order book updates and trade notifications, with REST fallback for order placement. A practical architecture uses PostgreSQL or TimescaleDB for time-series market data storage, Redis for caching order book state and rate limiting, APScheduler or Celery for task scheduling, and Docker containers on AWS EC2 (ideally us-east-1 for proximity to Kalshi's infrastructure). REST API round-trips typically run 50–200ms; WebSocket provides lower-latency streaming. Telegram bots are the community standard for real-time monitoring and alerts.

Several open-source projects provide starting points. Notable repositories include nikhilnd/kalshi-market-making (end-to-end S&P 500 market making with WebSocket, Cauchy pricing, and PostgreSQL), ryanfrigo/kalshi-ai-trading-bot (5-LLM ensemble with portfolio optimization), cpratim/Kalshi-Weather-Trading (temperature market bot), vladmeer/kalshi-arbitrage-bot (probability arbitrage), and CarlosIbCu/polymarket-kalshi-btc-arbitrage-bot (cross-platform Bitcoin arbitrage). Kalshi's own GitHub organization provides starter code and Jupyter notebook examples.

-----

## The real obstacles you'll face

Liquidity is the dominant constraint. Outside sports, order books are thin enough that a 1,000-contract order at $0.42 might find only 200 contracts available at that price, with the remainder filling at $0.43–$0.44 and erasing the edge. Kalshi has responded by implementing a Liquidity Incentive Program, eliminating maker fees on most markets, and filing for an RFQ (Request for Quote) system specifically to address large-order slippage. But for algorithmic traders, this means sizing positions carefully and using limit orders exclusively — market orders in thin books are a reliable way to destroy alpha.

Edge decay is accelerating. Susquehanna International Group, DL Trading (founded by a former Chicago HFT trader), and reportedly Jump Trading are now active market makers on Kalshi. Cross-platform arbitrage windows between Kalshi and Polymarket last seconds, not minutes. The 4AM Club newsletter warns: "As retail volumes grow, established trading firms like Susquehanna, Jump or even Citadel will have the access to capital, existing infrastructure, and talent to eat up more and more markets." However, the long tail of niche markets — where deploying capital yields too little absolute profit for institutional desks but meaningful returns for individuals — should persist.

Tax treatment is genuinely unsettled. The IRS has issued no specific guidance on prediction market contracts. Three possible frameworks apply: Section 1256 treatment (60/40 long-term/short-term split — most favorable), standard capital gains, or gambling income (ordinary income with losses deductible only against gambling winnings — worst case). The difference can exceed 10 percentage points in effective tax rate. Kalshi does not issue 1099-B forms for standard event contract trading, leaving traders to self-report. Consulting a tax professional familiar with derivatives is essential before deploying significant capital.

Regulatory risk is real and evolving. While Kalshi operates as a CFTC-regulated Designated Contract Market, multiple states have challenged its sports contracts — Massachusetts issued a preliminary injunction requiring geofencing in January 2026, while Nevada and New Jersey courts sided with Kalshi on federal preemption. These cases may reach the Supreme Court. A class-action lawsuit filed in November 2025 adds additional uncertainty. The contract types available to trade could change based on legal outcomes.

Position limits default to $25,000 maximum loss per contract for retail members, though some high-profile contracts allow up to $50 million for Eligible Contract Participants. Kalshi's late-2024 shift toward Position Accountability Levels provides more flexibility but also more discretion to the exchange. Market manipulation rules prohibit wash trading, front-running, spoofing, and trading on material non-public information, with active surveillance by Kalshi's regulatory staff.

-----

## Conclusion: where to start and what matters most

The most actionable path for a technically skilled builder entering Kalshi algorithmic trading follows a clear sequence. Start with weather temperature markets — they resolve daily, have publicly available model data that demonstrably outperforms market pricing, and multiple open-source bots provide working reference implementations. The edge is quantifiable (compare GFS ensemble probabilities to market prices), the feedback loop is fast (daily settlement), and the capital requirements are modest ($1,000–$5,000 to begin).

Simultaneously build out economic data market models using FRED, Cleveland Fed nowcasts, and Atlanta Fed GDPNow as inputs. The Fed's own research validates that these markets produce superior forecasts but remain noisy due to thin retail liquidity — precisely the condition where a well-calibrated model extracts value. The monthly resolution cadence means positions tie up capital longer but individual trades can be higher conviction.

The structural favorite-longshot bias offers a category-agnostic overlay: systematically prefer maker positions on high-probability outcomes (contracts above 50¢) and avoid longshot speculation (contracts below 10¢). This alone generated +1.9% per trade historically across 300,000+ contracts.

Three architectural principles matter more than strategy sophistication. First, fee awareness: many apparent edges disappear after Kalshi's probability-weighted fee formula, so every signal should be evaluated net of fees before trading. Second, fractional Kelly sizing: probability estimation errors are inevitable, and 0.25x Kelly protects against ruin far better than full Kelly while capturing most of the growth. Third, start on demo: Kalshi's demo API at demo-api.kalshi.co mirrors production exactly and lets you validate execution logic before risking capital. The difference between a working backtest and a profitable live system is almost entirely in the details of order management, fill assumptions, and fee calculations that only live (or demo) trading reveals.
