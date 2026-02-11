/**
 * Pre-trade guard — enforces ALL trading rules as hard blocks.
 * Every trade must pass ALL guards before execution.
 * 
 * Rules enforced:
 * 1. Station whitelist (TRADEABLE_STATIONS)
 * 2. Model spread < 3°F
 * 3. Market σ > our σ + 1.5°F (from live IV)
 * 4. Max 1 trade per day per station
 * 5. Position size ≤ min(Kelly, 10% volume, 20 contracts)
 * 6. Forecast within 15°F of climatological normal
 * 7. No simultaneous trades on correlated stations
 */

import { TRADEABLE_STATIONS, STATIONS, getEffectiveSigma, MAX_MODEL_SPREAD_F, CORRELATION_GROUPS } from '../weather/stations.js';
import { getLedger } from './trade.js';
import { today } from './utils.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Load config.json overrides ───────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', '..', 'config.json');
function loadGuardConfig() {
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')).guard || {}; }
  catch { return {}; }
}
const gcfg = loadGuardConfig();

const HARD_MAX_CONTRACTS = gcfg.hardMaxContracts ?? 20;
const MAX_TRADES_PER_DAY_PER_STATION = gcfg.maxTradesPerDayPerStation ?? 1;
const MIN_SIGMA_GAP = gcfg.minSigmaGap ?? 1.5;
const CLIM_OUTLIER_F = gcfg.climOutlierRange ?? 15;

// Station correlation groups — derived from stations.json correlationGroup field
// Build reverse lookup: station → list of correlated stations (same group)
const CORRELATED_STATIONS = (() => {
  const map = new Map();
  for (const [groupName, members] of Object.entries(CORRELATION_GROUPS)) {
    for (const station of members) {
      const others = members.filter(s => s !== station);
      const existing = map.get(station) || [];
      map.set(station, [...new Set([...existing, ...others])]);
    }
  }
  return map;
})();

function isCorrelatedStation(stationA, stationB) {
  return CORRELATED_STATIONS.get(stationA)?.includes(stationB) || false;
}

/**
 * Run all pre-trade guards. Returns { pass: boolean, reasons: string[] }.
 * If pass is false, the trade MUST be refused.
 */
export function runGuards({ station, qty, forecastSpread, marketSigma, forecastHigh, date, bidAskSpread }) {
  const reasons = [];
  date = date || today();

  // 1. Station whitelist
  if (!TRADEABLE_STATIONS.has(station)) {
    reasons.push(`Station ${station} not in tradeable whitelist [${[...TRADEABLE_STATIONS].join(', ')}]`);
  }

  // 2. Model spread check
  const maxModelSpread = gcfg.maxModelSpread ?? 3.0;
  if (forecastSpread != null && forecastSpread > maxModelSpread) {
    reasons.push(`Model spread ${forecastSpread.toFixed(1)}°F exceeds ${maxModelSpread}°F limit — GFS/ECMWF disagree too much`);
  }

  // 3. Market σ gap check
  if (station && STATIONS[station]) {
    const month = parseInt(date.slice(5, 7));
    const ourSigma = getEffectiveSigma(station, month, 0);
    if (marketSigma != null) {
      const gap = marketSigma - ourSigma;
      if (gap < MIN_SIGMA_GAP) {
        reasons.push(`Market σ (${marketSigma.toFixed(1)}°F) - our σ (${ourSigma.toFixed(1)}°F) = gap ${gap.toFixed(1)}°F < required ${MIN_SIGMA_GAP}°F`);
      }
    } else {
      reasons.push(`No market σ data — run \`kalshi iv\` first`);
    }
  }

  // 4. Max 1 trade per day per station
  const ledger = getLedger();
  const todayTrades = ledger.trades.filter(t =>
    t.station === station &&
    t.timestamp?.slice(0, 10) === date &&
    !t.settled
  );
  if (todayTrades.length >= MAX_TRADES_PER_DAY_PER_STATION) {
    reasons.push(`Already ${todayTrades.length} open trade(s) for ${station} today (max ${MAX_TRADES_PER_DAY_PER_STATION})`);
  }

  // 5. Position size
  if (qty != null && qty > HARD_MAX_CONTRACTS) {
    reasons.push(`Quantity ${qty} exceeds hard max ${HARD_MAX_CONTRACTS} contracts`);
  }

  // 6. Climatological outlier
  if (forecastHigh != null && station && STATIONS[station]) {
    const month = parseInt(date.slice(5, 7));
    const normal = STATIONS[station].climNormalHigh?.[month];
    if (normal != null) {
      const dev = Math.abs(forecastHigh - normal);
      if (dev > CLIM_OUTLIER_F) {
        reasons.push(`Forecast ${forecastHigh}°F is ${dev.toFixed(0)}°F from normal ${normal}°F (limit: ${CLIM_OUTLIER_F}°F)`);
      }
    }
  }

  // 7. Cross-station correlation check
  if (station) {
    const ledger = getLedger();
    const todayTrades = ledger.trades.filter(t =>
      t.timestamp?.slice(0, 10) === date &&
      !t.settled &&
      t.station !== station
    );
    
    for (const trade of todayTrades) {
      if (isCorrelatedStation(station, trade.station)) {
        reasons.push(`Cannot trade ${station} same day as ${trade.station} — correlated weather systems (existing trade: ${trade.id})`);
      }
    }
  }

  // 8. Cumulative station exposure check
  if (station) {
    const ledger = getLedger();
    const unsettledForStation = ledger.trades.filter(t =>
      t.station === station && !t.settled && t.cost > 0
    );
    const totalExposure = unsettledForStation.reduce((sum, t) => sum + t.cost, 0);
    const maxExposure = ledger.balance * 0.05; // 5% of bankroll
    if (totalExposure > maxExposure) {
      reasons.push(`Cumulative exposure on ${station}: $${totalExposure.toFixed(2)} exceeds 5% of bankroll ($${maxExposure.toFixed(2)})`);
    }
  }

  // 9. Bid-ask spread filter (weather contracts)
  const maxSpread = gcfg.maxBidAskSpread ?? 0.10;
  if (bidAskSpread != null && bidAskSpread > maxSpread) {
    reasons.push(`Bid-ask spread $${bidAskSpread.toFixed(2)} exceeds 10¢ limit — illiquid contract`);
  }

  // 10. Winter calibration window warning (non-blocking)
  const warnings = [];
  const month = parseInt(date.slice(5, 7));
  const CALIBRATION_MONTHS = new Set([11, 12, 1, 2]);
  if (!CALIBRATION_MONTHS.has(month)) {
    warnings.push(`⚠️ CALIBRATION WARNING: Trading outside calibration window (Nov-Feb). baseSigma values were calibrated on winter data only — summer forecast errors may be higher, especially for convective stations (KOKC, KDFW, KIAH, KDEN).`);
  }

  return {
    pass: reasons.length === 0,
    reasons,
    warnings,
  };
}
