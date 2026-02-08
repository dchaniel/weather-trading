/**
 * Quarter-Kelly position sizing for binary contracts.
 *
 * f* = (p_true - p_market) / (1 - p_market)
 * We use f*/4 (quarter-Kelly) for safety.
 */

export function kellyFraction(pTrue, pMarket) {
  if (pTrue <= pMarket) return 0; // no edge
  return (pTrue - pMarket) / (1 - pMarket);
}

export function quarterKelly(pTrue, pMarket) {
  return kellyFraction(pTrue, pMarket) / 4;
}

export function positionSize(bankroll, pTrue, pMarket, maxPct = 0.05) {
  const f = quarterKelly(pTrue, pMarket);
  if (f <= 0) return { contracts: 0, fraction: 0, edge: 0 };

  const edge = pTrue - pMarket;
  const fraction = Math.min(f, maxPct); // cap at 5% of bankroll
  const dollarAmount = bankroll * fraction;
  const costPerContract = pMarket; // in cents for Kalshi
  const contracts = Math.floor((dollarAmount * 100) / costPerContract);

  return {
    contracts,
    fraction: Math.round(fraction * 10000) / 10000,
    edge: Math.round(edge * 1000) / 1000,
    kellyFull: Math.round(kellyFraction(pTrue, pMarket) * 1000) / 1000,
    dollarRisk: Math.round(contracts * costPerContract) / 100,
  };
}
