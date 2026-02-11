/**
 * Risk management — limits, circuit breakers, and status reporting.
 */

import { getLedger, getOpenPositions, getTotalPnL } from './trade.js';
import { today } from './utils.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Load config.json overrides ───────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', '..', 'config.json');

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch { return {}; }
}

// ── Risk Parameters (overridable via config.json → risk.*) ───────────────────

const DEFAULTS = {
  maxDailyLossPct: 0.05,
  maxOpenPositions: 5,
  maxPositionPct: 0.05,
  maxStationExposure: 0.10,
  drawdownPct: 0.20,
  peakBankroll: 1000,
  maxPerStation: 3,
  initialBankroll: 1000,
};

const cfg = loadConfig().risk || {};
export const RISK_LIMITS = { ...DEFAULTS, ...cfg };

/** Compute proportional risk limits based on current bankroll */
export function getEffectiveRiskLimits(balance) {
  const peak = Math.max(RISK_LIMITS.peakBankroll, balance);
  return {
    ...RISK_LIMITS,
    maxDailyLoss: -(balance * RISK_LIMITS.maxDailyLossPct),
    drawdownFloor: peak * (1 - RISK_LIMITS.drawdownPct),
  };
}

// ── Risk Checks ──────────────────────────────────────────────────────────────

export function getDailyPnL(date = today()) {
  const ledger = getLedger();
  // Count P&L for trades PLACED today (by timestamp), not by settlement date.
  // This prevents yesterday's trades settling overnight from blocking today's trading.
  return ledger.trades
    .filter(t => t.settled && t.timestamp?.startsWith(date) && t.pnl != null)
    .reduce((sum, t) => sum + t.pnl, 0);
}

export function getDailyCost(date = today()) {
  const ledger = getLedger();
  return ledger.trades
    .filter(t => t.timestamp?.startsWith(date) && !t.settled)
    .reduce((sum, t) => sum + t.cost, 0);
}

export function getPeakBankroll() {
  const ledger = getLedger();
  return Math.max(RISK_LIMITS.initialBankroll, ledger.balance);
}

export function positionsPerStation() {
  const open = getOpenPositions();
  const counts = {};
  for (const t of open) {
    counts[t.station] = (counts[t.station] || 0) + 1;
  }
  return counts;
}

/**
 * Run all risk checks. Returns { allowed: bool, violations: string[] }.
 */
export function checkRiskLimits(station = null, tradeCost = 0) {
  const violations = [];
  const ledger = getLedger();
  const open = getOpenPositions();
  const dailyPnL = getDailyPnL();
  const limits = getEffectiveRiskLimits(ledger.balance);

  if (dailyPnL <= limits.maxDailyLoss) {
    violations.push(`Daily P&L $${dailyPnL.toFixed(2)} exceeds max loss of $${limits.maxDailyLoss.toFixed(2)}`);
  }
  if (open.length >= RISK_LIMITS.maxOpenPositions) {
    violations.push(`${open.length} open positions (max ${RISK_LIMITS.maxOpenPositions})`);
  }
  if (tradeCost > 0 && tradeCost > ledger.balance * RISK_LIMITS.maxPositionPct) {
    violations.push(`Trade cost $${tradeCost.toFixed(2)} exceeds ${(RISK_LIMITS.maxPositionPct * 100)}% of bankroll ($${(ledger.balance * RISK_LIMITS.maxPositionPct).toFixed(2)})`);
  }
  if (ledger.balance < limits.drawdownFloor) {
    violations.push(`Bankroll $${ledger.balance.toFixed(2)} below drawdown floor $${limits.drawdownFloor.toFixed(2)} — CIRCUIT BREAKER`);
  }
  if (station) {
    const perStation = positionsPerStation();
    if ((perStation[station] || 0) >= RISK_LIMITS.maxPerStation) {
      violations.push(`${perStation[station]} positions on ${station} (max ${RISK_LIMITS.maxPerStation})`);
    }
    // Cumulative station exposure check
    const stationCost = open
      .filter(t => t.station === station)
      .reduce((sum, t) => sum + (t.cost || 0), 0);
    const maxExposure = ledger.balance * RISK_LIMITS.maxStationExposure;
    if (stationCost > maxExposure) {
      violations.push(`Station ${station} exposure $${stationCost.toFixed(2)} exceeds ${(RISK_LIMITS.maxStationExposure * 100)}% of bankroll ($${maxExposure.toFixed(2)})`);
    }
  }

  return { allowed: violations.length === 0, violations };
}

export function getRiskStatus() {
  const ledger = getLedger();
  const open = getOpenPositions();
  const dailyPnL = getDailyPnL();
  const totalPnL = getTotalPnL();
  const perStation = positionsPerStation();
  const peak = getPeakBankroll();
  const drawdown = peak > 0 ? ((peak - ledger.balance) / peak * 100) : 0;
  const check = checkRiskLimits();

  return {
    balance: ledger.balance,
    totalPnL,
    dailyPnL,
    openPositions: open.length,
    maxOpenPositions: RISK_LIMITS.maxOpenPositions,
    positionsPerStation: perStation,
    peakBankroll: peak,
    drawdown: Math.round(drawdown * 10) / 10,
    drawdownFloor: getEffectiveRiskLimits(ledger.balance).drawdownFloor,
    maxDailyLoss: getEffectiveRiskLimits(ledger.balance).maxDailyLoss,
    maxPositionPct: RISK_LIMITS.maxPositionPct,
    tradingAllowed: check.allowed,
    violations: check.violations,
  };
}
