/**
 * Crypto command — prices, signals, and market analysis.
 * Shows only actionable information. Honest about when not to trade.
 */

import { getCurrentPrices, getAllHistoricalPrices, COINS } from '../lib/crypto/prices.js';
import { generateSignals, cryptoProbAbove } from '../lib/crypto/forecast.js';
import { getCryptoMarkets } from '../lib/crypto/markets.js';
import { runCryptoStrategy } from '../lib/crypto/strategy.js';
import { signed, round2 } from '../lib/core/utils.js';
import { TRANSACTION_COST } from '../lib/core/sizing.js';

export default async function(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: kalshi crypto [flags]

Analyze crypto markets for momentum & volatility signals.

Flags:
  -h, --help   Show this help

Shows:
  • Current prices & 24h changes for BTC/ETH
  • GARCH volatility estimates
  • Kalshi crypto contract opportunities
  • Trade signals when edge ≥5%

Examples:
  kalshi crypto              # Full crypto analysis
`);
    return;
  }

  console.log('\n₿  Crypto Analysis');
  console.log('═'.repeat(60));

  // Run the full strategy
  let result;
  try {
    result = await runCryptoStrategy();
  } catch (e) {
    console.log(`  ⚠ Error: ${e.message}\n`);
    return;
  }

  // Show current prices + signals
  console.log('\n  Current Prices & Signals:');
  for (const [symbol, coin] of Object.entries(result.coins)) {
    if (!coin.current) continue;
    const d = coin.current;
    const chg = d.change24h != null ? ` (${d.change24h >= 0 ? '+' : ''}${d.change24h.toFixed(1)}% 24h)` : '';
    console.log(`\n  ${symbol}: $${d.price.toLocaleString()}${chg}`);

    if (coin.signals) {
      const s = coin.signals;
      console.log(`    GARCH Vol:  7d=${(s.vol7d * 100).toFixed(0)}%  30d=${(s.vol30d * 100).toFixed(0)}%`);
      console.log(`    Real Vol:   7d=${(s.realVol7d * 100).toFixed(0)}%  30d=${(s.realVol30d * 100).toFixed(0)}%`);
      console.log(`    Kurtosis:   ${s.excessKurtosis.toFixed(1)} (${s.excessKurtosis > 5 ? 'very fat tails' : s.excessKurtosis > 2 ? 'fat tails' : 'mild'})`);
      console.log(`    RSI:        ${s.rsi}${s.rsi > 70 ? ' ⚠ OVERBOUGHT' : s.rsi < 30 ? ' ⚠ OVERSOLD' : ''}`);
      console.log(`    Drift adj:  ${signed(s.drift * 100, 1)}% annualized`);
      if (s.signals.length) console.log(`    Signals:    ${s.signals.join(', ')}`);
    }
  }

  // Market summary
  const sum = result.summary;
  console.log(`\n  Kalshi Markets: ${sum.marketsFound} found, ${sum.marketsLiquid} liquid (spread ≤20%)`);
  if (sum.skipped.illiquid) console.log(`    Skipped ${sum.skipped.illiquid} illiquid markets`);

  // Show filtered markets (±1σ strikes only)
  for (const m of result.kalshiMarkets) {
    const coin = result.coins[m.symbol];
    const currentPrice = coin?.current?.price;
    const vol = coin?.signals?.vol7d || 0.30; // Default to 30% vol if no data
    
    if (!currentPrice) continue;
    
    // Calculate ±1σ price range (daily move)
    const dailyVol = vol / Math.sqrt(365);
    const lowerBound = currentPrice * (1 - dailyVol);
    const upperBound = currentPrice * (1 + dailyVol);
    
    for (const event of m.events) {
      const liquidMkts = event.markets.filter(mkt => {
        const spread = mkt.yesAsk - mkt.yesBid;
        return mkt.yesBid > 0 && mkt.yesAsk > 0 && spread <= 0.20;
      });
      
      // Filter to ±1σ strikes only
      const inRangeMkts = liquidMkts.filter(mkt => {
        const strike = mkt.floorStrike;
        if (!strike) return false;
        return strike >= lowerBound && strike <= upperBound;
      });
      
      if (inRangeMkts.length === 0) continue;
      
      console.log(`\n  ${m.symbol} — ${event.title || m.seriesTicker} (±1σ: $${Math.round(lowerBound).toLocaleString()}-$${Math.round(upperBound).toLocaleString()})`);
      
      for (const mkt of inRangeMkts.slice(0, 3)) {
        const label = mkt.floorStrike ? `>$${mkt.floorStrike.toLocaleString()}` : mkt.title || '?';
        const spread = (mkt.yesAsk - mkt.yesBid);
        console.log(`    ${label.padEnd(16)} bid:${mkt.yesBid.toFixed(2)} ask:${mkt.yesAsk.toFixed(2)} spread:${(spread * 100).toFixed(0)}%`);
      }
    }
  }

  // Log crypto decisions to history
  try {
    const { appendDecision } = await import('../lib/core/history.js');
    
    // Log each recommendation decision
    for (const rec of result.allRecommendations) {
      const guardStates = {
        liquidityFilter: 'PASS',
        priceFilter: 'PASS', 
        edgeFilter: rec.edge >= 0.05 ? 'PASS' : 'FAIL:edge_too_low',
      };
      
      const action = rec.edge >= 0.05 ? 'CRYPTO_APPROVED' : 'CRYPTO_BLOCKED';
      const netEdge = rec.edge - TRANSACTION_COST; // Subtract transaction costs
      
      appendDecision(rec.symbol, action, guardStates, netEdge);
    }
  } catch (e) {
    // Don't fail command if history logging fails
  }

  // Recommendations
  if (result.recommendations.length > 0) {
    console.log('\n  🎯 Actionable Trades (executable price, ≥5% edge):');
    for (const rec of result.recommendations) {
      console.log(`\n    ${rec.side} ${rec.ticker} (${rec.symbol} ${rec.threshold > 1000 ? '>$' + rec.threshold.toLocaleString() : '>$' + rec.threshold})`);
      console.log(`      Entry @ $${rec.execPrice.toFixed(2)} (${rec.side === 'YES' ? 'ask' : 'no-ask'}) | mid: $${rec.midPrice.toFixed(2)} | spread: ${(rec.spread * 100).toFixed(0)}%`);
      const grossEdgeDisplay = rec.grossEdge ? ` (gross: ${signed(rec.grossEdge * 100, 1)}%)` : '';
      console.log(`      P(model): ${(rec.pEst * 100).toFixed(1)}%  Net Edge: ${signed(rec.edge * 100, 1)}%${grossEdgeDisplay}`);
      console.log(`      Vol: ${(rec.vol * 100).toFixed(0)}% | Kurt: ${rec.exKurtosis} | Drift: ${signed(rec.drift * 100, 1)}%`);
      console.log(`      Expires: ${rec.daysToExpiry}d | Size: ${rec.contracts}x ($${rec.dollarRisk.toFixed(2)} risk)`);
    }
    if (result.allRecommendations.length > result.recommendations.length) {
      console.log(`\n    (${result.allRecommendations.length - result.recommendations.length} additional lower-conviction edges not shown)`);
    }
  } else {
    console.log('\n  ⛔ No actionable trades.');
    console.log('     Reasons: spreads too wide, model edge < 5% at executable prices,');
    console.log('     or insufficient liquidity. This is normal for crypto on Kalshi.');
  }

  console.log();
}
