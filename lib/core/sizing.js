/**
 * Kelly criterion position sizing for binary contracts.
 * Uses quarter-Kelly for conservative sizing.
 *
 * TODO: Correlation discount — stations in the same correlationGroup (see
 * stations.json) share weather patterns. When multiple positions are open in
 * the same group (e.g. texas_oklahoma: KDFW+KAUS+KOKC+KIAH), Kelly fractions
 * should be reduced (e.g. multiply by 0.5 per additional correlated position)
 * to avoid over-concentration. Currently handled by maxTradesPerDay=1 guard,
 * but a proper correlation-aware Kelly would treat correlated bets as partially
 * the same bet. See CORRELATION_GROUPS in lib/weather/stations.js.
 */

/** Standard transaction cost per contract (4¢) - includes exchange fees and typical spread costs */
export const TRANSACTION_COST = 0.04;

export function kellyFraction(pTrue, pMarket) {
  if (pTrue <= pMarket) return 0;
  return (pTrue - pMarket) / (1 - pMarket);
}

export function quarterKelly(pTrue, pMarket) {
  return kellyFraction(pTrue, pMarket) / 4;
}

/** Default max contracts when volume data is unavailable */
const DEFAULT_MAX_CONTRACTS = 20;
/** Absolute hard cap on contracts per trade */
const HARD_MAX_CONTRACTS = 20;
/** Max dollar risk per weather trade (to limit NO-trade exposure) */
const MAX_WEATHER_TRADE_RISK = 5.0;

/**
 * Calculate position size for a binary contract.
 * @param {number} bankroll — current balance in dollars
 * @param {number} pTrue — our estimated probability (0-1)
 * @param {number} pMarket — market-implied probability (0-1)
 * @param {number} maxPct — max fraction of bankroll to risk (default 5%)
 * @param {object} opts — additional options
 * @param {number} opts.volume — daily volume for liquidity cap (optional)
 * @param {string} opts.strategy — strategy type ('weather', 'crypto', etc.) for risk caps
 * @returns {{ contracts, fraction, edge, kellyFull, dollarRisk, liquidityCapped, riskCapped }}
 */
export function positionSize(bankroll, pTrue, pMarket, maxPct = 0.05, opts = {}) {
  const f = quarterKelly(pTrue, pMarket);
  if (f <= 0) return { contracts: 0, fraction: 0, edge: 0, kellyFull: 0, dollarRisk: 0, liquidityCapped: false, riskCapped: false };

  const edge = pTrue - pMarket;
  const fraction = Math.min(f, maxPct);
  const dollarAmount = bankroll * fraction;
  const costPerContract = pMarket;
  const kellyContracts = Math.max(1, Math.floor(dollarAmount / costPerContract));

  // Liquidity filter: min(Kelly size, 10% of daily volume, hard cap)
  const volume = opts.volume;
  const volumeCap = volume != null ? Math.floor(volume * 0.10) : DEFAULT_MAX_CONTRACTS;
  let maxContracts = Math.min(HARD_MAX_CONTRACTS, Math.max(1, volumeCap));
  
  // Weather strategy risk cap: max $5 risk per trade (to limit NO-trade exposure)
  let riskCapped = false;
  if (opts.strategy === 'weather') {
    const riskCap = Math.floor(MAX_WEATHER_TRADE_RISK / costPerContract);
    if (riskCap < maxContracts) {
      maxContracts = Math.max(1, riskCap);
      riskCapped = true;
    }
  }
  
  const contracts = Math.min(kellyContracts, maxContracts);
  const liquidityCapped = contracts < kellyContracts && !riskCapped;
  
  const dollarRisk = contracts * costPerContract;

  return {
    contracts,
    fraction,
    edge,
    kellyFull: kellyFraction(pTrue, pMarket),
    dollarRisk: Math.round(dollarRisk * 100) / 100,
    liquidityCapped,
    riskCapped,
  };
}
