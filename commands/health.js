/**
 * kalshi health — System health and diagnostic checks.
 * Verifies API connectivity, data integrity, and operational status.
 */

import { exec } from 'child_process';
import { promises as fs } from 'fs';
import { fetchJSON } from '../lib/core/utils.js';
import { getLedger } from '../lib/core/trade.js';
import { STATIONS, TRADEABLE_STATIONS } from '../lib/weather/stations.js';
import { getSeriesMarkets } from '../lib/kalshi/client.js';

async function checkFileExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function checkAPIConnection(name, testFn) {
  try {
    await testFn();
    return { status: '✅', message: 'OK' };
  } catch (error) {
    return { status: '❌', message: error.message.slice(0, 50) };
  }
}

async function checkCronStatus() {
  return new Promise((resolve) => {
    exec('crontab -l 2>/dev/null | grep -q "collect-iv\\|weather-trading" && echo "active" || echo "inactive"', 
      (error, stdout) => {
        const isActive = stdout.trim() === 'active';
        resolve({
          status: isActive ? '✅' : '⚠️',
          message: isActive ? 'Cron jobs detected' : 'No cron jobs found'
        });
      });
  });
}

async function checkLedgerIntegrity() {
  try {
    const ledger = getLedger();
    const checks = [];
    
    // Check balance is positive
    checks.push({
      name: 'Balance positive',
      status: ledger.balance > 0 ? '✅' : '⚠️',
      message: `$${ledger.balance.toFixed(2)}`
    });
    
    // Check for valid trade IDs
    const duplicateIds = new Set();
    const ids = ledger.trades.map(t => t.id).filter(id => {
      if (duplicateIds.has(id)) return true;
      duplicateIds.add(id);
      return false;
    });
    checks.push({
      name: 'No duplicate trade IDs',
      status: ids.length === 0 ? '✅' : '❌',
      message: ids.length > 0 ? `${ids.length} duplicates found` : 'OK'
    });
    
    // Check trade data completeness
    const incompleteTrades = ledger.trades.filter(t => !t.id || !t.timestamp || t.qty == null);
    checks.push({
      name: 'Trade data complete',
      status: incompleteTrades.length === 0 ? '✅' : '⚠️',
      message: incompleteTrades.length > 0 ? `${incompleteTrades.length} incomplete` : 'OK'
    });
    
    return checks;
  } catch (error) {
    return [{ name: 'Ledger integrity', status: '❌', message: error.message }];
  }
}

async function checkIVHistory() {
  try {
    const historyExists = await checkFileExists('data/history/markets.jsonl');
    if (!historyExists) {
      return { status: '⚠️', message: 'No market history file found (run `kalshi data snapshot`)' };
    }
    
    const content = await fs.readFile('data/history/markets.jsonl', 'utf8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    
    if (lines.length === 0) {
      return { status: '⚠️', message: '0 IV snapshots' };
    }
    
    // Check most recent snapshot
    const latest = JSON.parse(lines[lines.length - 1]);
    const latestDate = new Date(latest.timestamp);
    const hoursAgo = (Date.now() - latestDate.getTime()) / (1000 * 60 * 60);
    
    return {
      status: hoursAgo < 24 ? '✅' : '⚠️',
      message: `${lines.length} snapshots, latest ${hoursAgo.toFixed(1)}h ago`
    };
  } catch (error) {
    return { status: '❌', message: error.message.slice(0, 50) };
  }
}

export default async function(args) {
  const verbose = args.includes('--verbose') || args.includes('-v');
  
  console.log('\n🏥 Weather Trading System Health Check');
  console.log('═'.repeat(55));
  
  // 1. API Key
  const kalshiKeyPath = '/home/node/.openclaw/workspace/skills/kalshi/kalshi_key.pem';
  const hasKalshiKey = await checkFileExists(kalshiKeyPath);
  console.log(`📋 Kalshi API Key:     ${hasKalshiKey ? '✅' : '❌'} ${hasKalshiKey ? 'Found' : 'Missing'}`);
  
  // 2. API Connectivity
  console.log('\n🌐 API Connectivity:');
  
  const nwsCheck = await checkAPIConnection('NWS', async () => {
    await fetchJSON('https://api.weather.gov/gridpoints/OKX/35,35/forecast');
  });
  console.log(`   NWS Forecast:       ${nwsCheck.status} ${nwsCheck.message}`);
  
  const gfsCheck = await checkAPIConnection('Open-Meteo GFS', async () => {
    await fetchJSON('https://api.open-meteo.com/v1/gfs?latitude=40.7&longitude=-74.0&daily=temperature_2m_max&temperature_unit=fahrenheit&start_date=2026-02-10&end_date=2026-02-10');
  });
  console.log(`   Open-Meteo GFS:     ${gfsCheck.status} ${gfsCheck.message}`);
  
  const ecmwfCheck = await checkAPIConnection('Open-Meteo ECMWF', async () => {
    await fetchJSON('https://api.open-meteo.com/v1/ecmwf?latitude=40.7&longitude=-74.0&daily=temperature_2m_max&temperature_unit=fahrenheit&start_date=2026-02-10&end_date=2026-02-10');
  });
  console.log(`   Open-Meteo ECMWF:   ${ecmwfCheck.status} ${ecmwfCheck.message}`);
  
  if (hasKalshiKey) {
    const kalshiCheck = await checkAPIConnection('Kalshi Markets', async () => {
      await getSeriesMarkets('KXHIGHNY');
    });
    console.log(`   Kalshi Markets:     ${kalshiCheck.status} ${kalshiCheck.message}`);
  } else {
    console.log(`   Kalshi Markets:     ⚠️ No API key to test`);
  }
  
  // 3. Data Integrity
  console.log('\n💾 Data Integrity:');
  const ledgerChecks = await checkLedgerIntegrity();
  for (const check of ledgerChecks) {
    console.log(`   ${check.name.padEnd(18)}: ${check.status} ${check.message}`);
  }
  
  // 4. IV History
  const ivCheck = await checkIVHistory();
  console.log(`   IV History:         ${ivCheck.status} ${ivCheck.message}`);
  
  // 5. Automation Status
  console.log('\n⚙️  Automation:');
  const cronCheck = await checkCronStatus();
  console.log(`   Cron Jobs:          ${cronCheck.status} ${cronCheck.message}`);
  
  // 6. Station Configuration
  console.log('\n📍 Station Config:');
  console.log(`   Tradeable Stations: ✅ ${TRADEABLE_STATIONS.size} configured`);
  console.log(`   Total Stations:     ✅ ${Object.keys(STATIONS).length} available`);
  
  // 7. Summary
  console.log('\n' + '═'.repeat(55));
  const allChecks = [
    { name: 'API Key', status: hasKalshiKey },
    { name: 'NWS API', status: nwsCheck.status === '✅' },
    { name: 'GFS API', status: gfsCheck.status === '✅' },
    { name: 'ECMWF API', status: ecmwfCheck.status === '✅' },
    { name: 'Ledger', status: ledgerChecks.every(c => c.status === '✅') },
    { name: 'IV History', status: ivCheck.status === '✅' },
  ];
  
  const passing = allChecks.filter(c => c.status).length;
  const total = allChecks.length;
  const healthScore = Math.round((passing / total) * 100);
  
  const overallStatus = healthScore >= 80 ? '🟢' : healthScore >= 60 ? '🟡' : '🔴';
  console.log(`${overallStatus} Overall Health: ${healthScore}% (${passing}/${total} checks pass)`);
  
  if (healthScore < 80) {
    console.log('\n⚠️  Issues Detected:');
    const failing = allChecks.filter(c => !c.status);
    for (const check of failing) {
      console.log(`   • ${check.name} failing`);
    }
    console.log('\nRecommendations:');
    if (!hasKalshiKey) console.log('   • Add Kalshi API key to enable market data');
    if (cronCheck.status === '⚠️') {
      console.log('   • No cron jobs found. Example crontab setup:');
      console.log('     crontab -e  # then add:');
      console.log('     0 */4 * * * cd $PROJECT && node bin/kalshi.js data collect --silent');
      console.log('     0 14 * * *  cd $PROJECT && node bin/kalshi.js data snapshot --silent');
    }
    if (ivCheck.status !== '✅') console.log('   • Run `kalshi data collect-iv` to start building IV history');
  }
  
  console.log();
}