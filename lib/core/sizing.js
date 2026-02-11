/**
 * Kelly criterion position sizing for binary contracts.
 * Uses quarter-Kelly for conservative sizing.
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

/**
 * Calculate position size for a binary contract.
 * @param {number} bankroll — current balance in dollars
 * @param {number} pTrue — our estimated probability (0-1)
 * @param {number} pMarket — market-implied probability (0-1)
 * @param {number} maxPct — max fraction of bankroll to risk (default 5%)
 * @param {object} opts — additional options
 * @param {number} opts.volume — daily volume for liquidity cap (optional)
 * @returns {{ contracts, fraction, edge, kellyFull, dollarRisk, liquidityCapped }}
 */
export function positionSize(bankroll, pTrue, pMarket, maxPct = 0.05, opts = {}) {
  const f = quarterKelly(pTrue, pMarket);
  if (f <= 0) return { contracts: 0, fraction: 0, edge: 0, kellyFull: 0, dollarRisk: 0, liquidityCapped: false };

  const edge = pTrue - pMarket;
  const fraction = Math.min(f, maxPct);
  const dollarAmount = bankroll * fraction;
  const costPerContract = pMarket;
  const kellyContracts = Math.max(1, Math.floor(dollarAmount / costPerContract));

  // Liquidity filter: min(Kelly size, 10% of daily volume, hard cap)
  const volume = opts.volume;
  const volumeCap = volume != null ? Math.floor(volume * 0.10) : DEFAULT_MAX_CONTRACTS;
  const maxContracts = Math.min(HARD_MAX_CONTRACTS, Math.max(1, volumeCap));
  const contracts = Math.min(kellyContracts, maxContracts);
  const liquidityCapped = contracts < kellyContracts;
  
  const dollarRisk = contracts * costPerContract;

  return {
    contracts,
    fraction,
    edge,
    kellyFull: kellyFraction(pTrue, pMarket),
    dollarRisk: Math.round(dollarRisk * 100) / 100,
    liquidityCapped,
  };
}
