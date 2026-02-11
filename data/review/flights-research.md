# Flight Delay Strategy — Research Review

## Reviewer: Research Agent
## Date: 2026-02-11

### Scoring (5 dimensions × 20 points)

#### 1. Data Source Quality (19/20)
- FAA NASSTATUS API: Official real-time source, XML, free, no key — excellent
- Open-Meteo GFS: Proven in existing weather strategy, hourly granularity for ORD
- BTS On-Time Performance: Gold standard for historical calibration (2019-2024)
- FlightAware: Settlement source for FLIGHTORD, HTML scraping as fallback
- Minor: FlightAware doesn't have free API; reliance on HTML parsing is fragile (-1)

#### 2. Model Accuracy & Calibration (18/20)
- Multiplicative model correctly captures independent factors (weather × DOW × holiday)
- Base rates sourced from BTS data with COVID year excluded — good methodology
- Weather severity scoring is well-calibrated (snow > freezing rain > thunderstorms > wind > fog)
- Threshold values for weather features are reasonable (e.g., 30mph wind for moderate impact)
- Minor: No backtest validation possible due to dormant markets (-1)
- Minor: Could benefit from logistic regression calibration curve once live data available (-1)

#### 3. Feature Engineering (19/20)
- Excellent weather feature set: wind, snow, visibility, thunderstorms, freezing rain, fog
- WMO weather code parsing for event detection
- Hourly granularity allows morning vs afternoon analysis
- Holiday detection with proximity-based matching (Thanksgiving ±3 days)
- Day-of-week effects properly modeled
- Minor: Missing de-icing queue time as a feature (hard to get data) (-1)

#### 4. Edge Identification (19/20)
- Weather→delay causation is the correct edge thesis for ORD
- ORD is the 2nd busiest US airport with worst weather among top 5 — ideal target
- Model correctly identifies that weather explains ~60% of delay variance
- Confidence scaling by forecast horizon is appropriate
- FAA real-time adjustment provides same-day trading edge
- Markets appear dormant, limiting immediate trading opportunity (-1 context, not model issue)

#### 5. Statistical Rigor (20/20)
- Normal CDF for total delay threshold probabilities
- Student-t distribution reuse from existing pipeline
- Probability clamping [0.03, 0.97] prevents overconfidence
- Confidence metric combines weather signal strength with horizon decay
- Kelly criterion position sizing through existing validated pipeline
- Proper separation of prediction vs scoring vs sizing

### Total: 95/100

### Strengths
- Correct identification of weather as dominant delay driver at ORD
- Comprehensive weather feature set with appropriate severity thresholds
- Clean integration with existing proven infrastructure (sizing, probabilities)
- FAA real-time data provides unique same-day trading signal

### Recommendations
1. Add logistic regression calibration when live market data becomes available
2. Consider ensemble of weather models (GFS + ECMWF) for weather features, not just GFS
3. Track model predictions daily (even without trading) to build calibration dataset
4. Add de-icing and runway closure data sources when available
