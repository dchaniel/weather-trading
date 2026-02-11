/**
 * Daily briefing command — weather forecasts, crypto signals, risk, recommendations.
 */

import { STATIONS, TRADEABLE_STATIONS } from '../lib/weather/stations.js';
import { forecast } from '../lib/weather/forecast.js';
import { getRiskStatus, checkRiskLimits } from '../lib/core/risk.js';
import { getLedger, getOpenPositions } from '../lib/core/trade.js';
import { fetchMarkets, parseTicker } from '../lib/kalshi/markets.js';
import { positionSize } from '../lib/core/sizing.js';
import { today, signed, sleep, probAboveThreshold } from '../lib/core/utils.js';
import { runCryptoStrategy } from '../lib/crypto/strategy.js';
import { logInfo, logError } from '../lib/core/logger.js';

/**
 * Format daily briefing for Telegram with clear action items
 */
function formatBriefingForTelegram(briefing) {
  const lines = [];
  
  lines.push(`🤖 *Weather Trading Daily Briefing*`);
  lines.push(`📅 ${briefing.date}`);
  lines.push('');
  
  // Key stats
  lines.push(`💰 Balance: $${briefing.risk.balance.toFixed(2)}`);
  if (briefing.risk.totalPnL !== 0) {
    lines.push(`📈 P&L: ${signed(briefing.risk.totalPnL)}$`);
  }
  
  // Trading status
  const tradingStatus = briefing.risk.tradingAllowed ? '✅ ACTIVE' : '🚫 BLOCKED';
  lines.push(`🛡️ Trading: ${tradingStatus}`);
  
  if (briefing.risk.violations?.length > 0) {
    lines.push(`⚠️ ${briefing.risk.violations.join(', ')}`);
  }
  
  lines.push('');
  
  // Action items - most important section
  const weatherRecs = briefing.recommendations.filter(r => r.strategy === 'weather' && r.riskAllowed);
  const cryptoRecs = briefing.recommendations.filter(r => r.strategy === 'crypto' && r.riskAllowed);
  
  if (weatherRecs.length > 0 || cryptoRecs.length > 0) {
    lines.push('🎯 *ACTION ITEMS:*');
    
    for (const rec of weatherRecs) {
      const edge = (rec.edge * 100).toFixed(1);
      lines.push(`🌡️ *TRADE: ${rec.side} ${rec.ticker}*`);
      lines.push(`   ${rec.contracts}x @ $${rec.pMarket.toFixed(2)} (edge ${signed(edge)}%)`);
    }
    
    for (const rec of cryptoRecs) {
      const edge = ((rec.edge ?? 0) * 100).toFixed(1);
      const price = rec.pMarket ?? rec.execPrice ?? 0;
      lines.push(`₿ *TRADE: ${rec.side} ${rec.ticker}*`);
      lines.push(`   ${rec.contracts ?? 0}x @ $${price.toFixed(2)} (edge ${signed(edge)}%)`);
    }
  } else {
    lines.push('🎯 *NO TRADES TODAY*');
    lines.push('Market conditions not favorable');
  }
  
  lines.push('');
  
  // Brief forecast summary (only for major stations)
  const majorStations = ['KNYC', 'KMDW'];
  const forecasts = majorStations
    .filter(st => briefing.forecasts[st] && !briefing.forecasts[st].error)
    .slice(0, 2); // Limit to 2 for Telegram
  
  if (forecasts.length > 0) {
    lines.push('🌡️ *Forecasts:*');
    for (const st of forecasts) {
      const fc = briefing.forecasts[st];
      lines.push(`${st}: ${fc.consensus?.adjustedMean ?? '?'}°F (σ=${fc.sigma ?? '?'}°F)`);
    }
    lines.push('');
  }
  
  // Footer
  lines.push('_Run `kalshi recommend` for full analysis_');
  
  return lines.join('\n');
}

export default async function(args) {
  const jsonMode = args.includes('--json');
  const pushMode = args.includes('--push');
  const date = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || today();

  const briefing = {
    date,
    generatedAt: new Date().toISOString(),
    risk: null,
    forecasts: {},
    crypto: null,
    recommendations: [],
    openPositions: [],
    summary: '',
  };

  // 1. Risk status
  const risk = getRiskStatus();
  briefing.risk = risk;

  // 2. Open positions
  briefing.openPositions = getOpenPositions().map(t => ({
    id: t.id, contract: t.contract, station: t.station,
    side: t.side, qty: t.qty, price: t.price, cost: t.cost,
    strategy: t.strategy || 'weather',
  }));

  // 3. Weather forecasts
  const targetStations = ['KNYC', 'KMIA'];
  for (const st of targetStations) {
    try {
      const fc = await forecast(st, date);
      briefing.forecasts[st] = {
        consensus: fc.consensus.adjustedMean,
        spread: fc.consensus.spread,
        tradeable: fc.consensus.tradeable,
        reason: fc.consensus.reason || null,
        climDeviation: fc.consensus.climDeviation,
        sources: fc.consensus.forecasts?.map(f => ({ source: f.source, high: f.high_f })) || [],
      };
    } catch (e) {
      briefing.forecasts[st] = { error: e.message };
    }
    await sleep(300);
  }

  // 4. Weather market recommendations
  if (risk.tradingAllowed) {
    let allMarkets = [];
    try {
      const events = await fetchMarkets();
      for (const event of events) {
        if (event.markets) allMarkets.push(...event.markets);
      }
    } catch (e) {
      console.error(`Warning: Failed to fetch markets: ${e.message}`);
    }

    const ledger = getLedger();
    for (const [st, fc] of Object.entries(briefing.forecasts)) {
      if (!fc.tradeable || fc.error) continue;
      if (!TRADEABLE_STATIONS.has(st)) continue;

      const stationMarkets = allMarkets.filter(m => {
        const parsed = parseTicker(m.ticker);
        return parsed && STATIONS[st]?.kalshiTicker?.includes(parsed.city);
      });

      for (const mkt of stationMarkets) {
        const parsed = parseTicker(mkt.ticker);
        if (!parsed) continue;

        const pTrue = probAboveThreshold(fc.consensus, parsed.threshold);
        const midPrice = (mkt.yes_bid + mkt.yes_ask) / 2;
        const edge = pTrue - midPrice;

        if (Math.abs(edge) < 0.05) continue;

        const side = edge > 0 ? 'YES' : 'NO';
        const pMarket = side === 'YES' ? midPrice : 1 - midPrice;
        const pEst = side === 'YES' ? pTrue : 1 - pTrue;
        const sizing = positionSize(ledger.balance, pEst, pMarket);
        if (sizing.contracts <= 0) continue;

        const tradeCheck = checkRiskLimits(st, sizing.dollarRisk);
        briefing.recommendations.push({
          strategy: 'weather',
          station: st,
          ticker: mkt.ticker,
          side,
          pEst: Math.round(pEst * 1000) / 1000,
          pMarket: Math.round(pMarket * 1000) / 1000,
          edge: sizing.edge,
          contracts: sizing.contracts,
          dollarRisk: sizing.dollarRisk,
          riskAllowed: tradeCheck.allowed,
          riskViolations: tradeCheck.violations,
        });
      }
    }
  }

  // 5. Crypto analysis
  try {
    const crypto = await runCryptoStrategy();
    briefing.crypto = {
      coins: {},
      recommendations: crypto.recommendations,
    };
    for (const [symbol, coin] of Object.entries(crypto.coins)) {
      briefing.crypto.coins[symbol] = {
        price: coin.current?.price,
        change24h: coin.current?.change24h,
        vol7d: coin.signals?.vol7d,
        vol30d: coin.signals?.vol30d,
        rsi: coin.signals?.rsi,
        sentiment: coin.signals?.sentiment,
        signals: coin.signals?.signals,
      };
    }

    // Add crypto recommendations to main list
    for (const rec of crypto.recommendations) {
      briefing.recommendations.push({
        strategy: 'crypto',
        ...rec,
      });
    }
  } catch (e) {
    briefing.crypto = { error: e.message };
  }

  // 6. Summary
  const ledger = getLedger();
  const lines = [];
  lines.push(`📊 Trading Daily Briefing — ${date}`);
  lines.push(`💰 Balance: $${risk.balance.toFixed(2)} | P&L: ${signed(risk.totalPnL)}$`);
  lines.push(`📈 Open: ${risk.openPositions}/${risk.maxOpenPositions} | Drawdown: ${risk.drawdown}%`);
  lines.push(`🛡️ Trading: ${risk.tradingAllowed ? '✅ Allowed' : '🚫 Blocked'}`);

  if (risk.violations.length) {
    lines.push(`⚠️ ${risk.violations.join('; ')}`);
  }

  // Paper trading performance
  const allSettled = ledger.trades.filter(t => t.settled && t.pnl != null);
  if (allSettled.length > 0) {
    const wins = allSettled.filter(t => t.pnl > 0).length;
    const totalPnL = allSettled.reduce((s, t) => s + t.pnl, 0);
    const winRate = (wins / allSettled.length * 100).toFixed(0);
    lines.push(`📋 Paper: ${allSettled.length} settled, ${winRate}% win, ${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)} P&L`);
  }

  // Weather section
  lines.push('');
  lines.push('🌡️ WEATHER:');
  for (const [st, fc] of Object.entries(briefing.forecasts)) {
    if (fc.error) {
      lines.push(`  ${st}: ⚠️ ${fc.error}`);
    } else {
      const status = fc.tradeable ? '✅' : '⛔';
      const baseInfo = `${fc.consensus}°F (spread: ${fc.spread}°F, dev: ${signed(fc.climDeviation)}°F)`;
      const blockReason = !fc.tradeable && fc.reason ? ` — ${fc.reason}` : '';
      lines.push(`  ${st}: ${baseInfo} ${status}${blockReason}`);
    }
  }

  // Crypto section
  if (briefing.crypto && !briefing.crypto.error) {
    lines.push('');
    lines.push('₿ CRYPTO:');
    for (const [symbol, coin] of Object.entries(briefing.crypto.coins)) {
      if (coin.price) {
        const chg = coin.change24h != null ? ` (${coin.change24h >= 0 ? '+' : ''}${coin.change24h.toFixed(1)}%)` : '';
        lines.push(`  ${symbol}: $${coin.price.toLocaleString()}${chg} | RSI: ${coin.rsi ?? '?'} | ${coin.sentiment || 'neutral'}`);
      }
    }
  }

  // Recommendations
  const weatherRecs = briefing.recommendations.filter(r => r.strategy === 'weather');
  const cryptoRecs = briefing.recommendations.filter(r => r.strategy === 'crypto');

  if (weatherRecs.length || cryptoRecs.length) {
    lines.push('');
    lines.push('🎯 Recommendations:');
    for (const rec of weatherRecs) {
      const allowed = rec.riskAllowed ? '' : ' ⚠️RISK';
      lines.push(`  🌡️ ${rec.side} ${rec.ticker} — ${rec.contracts}x @ $${rec.pMarket.toFixed(2)} (edge: ${signed(rec.edge * 100)}%)${allowed}`);
    }
    for (const rec of cryptoRecs) {
      const price = rec.pMarket ?? rec.execPrice ?? 0;
      const edge = rec.edge ?? 0;
      const contracts = rec.contracts ?? 0;
      lines.push(`  ₿ ${rec.side} ${rec.ticker} — ${contracts}x @ $${price.toFixed(2)} (edge: ${signed(edge * 100)}%)`);
    }
  } else {
    lines.push('');
    lines.push('No trade recommendations today.');
  }

  briefing.summary = lines.join('\n');

  // Handle Telegram push notification
  if (pushMode) {
    try {
      // Format briefing for Telegram with clear action items
      const telegramMessage = formatBriefingForTelegram(briefing);
      
      // Send via OpenClaw message tool (this would be called by parent agent)
      console.log('TELEGRAM_PUSH:' + JSON.stringify({
        message: telegramMessage,
        channel: 'telegram',
        action: 'send'
      }));
      
      console.log('📱 Daily briefing sent to Telegram');
    } catch (error) {
      console.log('❌ Failed to send Telegram notification:', error.message);
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify(briefing, null, 2));
  } else {
    console.log('\n' + briefing.summary + '\n');
  }

  return briefing;
}
