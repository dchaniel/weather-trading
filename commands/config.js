/**
 * kalshi config — View and edit trading configuration.
 * All risk, guard, and execution parameters in one place.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', 'config.json');

function loadConfig() {
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return {}; }
}

function saveConfig(cfg) {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

export default function configCmd(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
kalshi config — View and edit trading configuration

Usage:
  kalshi config                          Show all settings
  kalshi config set <key> <value>        Set a parameter
  kalshi config reset                    Reset to defaults

Keys use dot notation: risk.maxOpenPositions, guard.hardMaxContracts, etc.

Examples:
  kalshi config set risk.maxOpenPositions 20
  kalshi config set guard.maxTradesPerDayPerStation 3
  kalshi config set execution.autoMaxContracts 20
  kalshi config set guard.hardMaxContracts 50
    `);
    return;
  }

  const sub = args[0];

  if (sub === 'set' && args.length >= 3) {
    const key = args[1];
    let value = args[2];
    // Parse numeric values
    if (!isNaN(value)) value = Number(value);
    if (value === 'true') value = true;
    if (value === 'false') value = false;

    const [section, param] = key.split('.');
    if (!section || !param) {
      console.error('Key must be section.param, e.g. risk.maxOpenPositions');
      process.exit(1);
    }

    const cfg = loadConfig();
    if (!cfg[section]) cfg[section] = {};
    const old = cfg[section][param];
    cfg[section][param] = value;
    saveConfig(cfg);
    console.log(`✅ ${key}: ${old ?? '(default)'} → ${value}`);
    return;
  }

  if (sub === 'reset') {
    const defaults = {
      risk: { maxOpenPositions: 5, maxDailyLossPct: 0.05, maxPositionPct: 0.05, maxStationExposure: 0.10, drawdownPct: 0.20, maxPerStation: 3 },
      guard: { hardMaxContracts: 20, maxTradesPerDayPerStation: 1, minSigmaGap: 1.5, maxModelSpread: 3.0, maxBidAskSpread: 0.10, climOutlierRange: 15 },
      execution: { autoMaxContracts: 5, kellyFraction: 0.25, transactionCost: 0.04 },
    };
    saveConfig(defaults);
    console.log('✅ Config reset to conservative defaults.');
    return;
  }

  // Show current config
  const cfg = loadConfig();
  console.log('\n⚙️  Kalshi Trading Configuration');
  console.log('═══════════════════════════════════════════════════');
  
  const sections = {
    risk: {
      maxOpenPositions: ['Max open positions', '(default: 5)'],
      maxDailyLossPct: ['Max daily loss %', '(default: 5%)'],
      maxPositionPct: ['Max position size %', '(default: 5%)'],
      maxStationExposure: ['Max station exposure %', '(default: 10%)'],
      drawdownPct: ['Drawdown circuit breaker %', '(default: 20%)'],
      maxPerStation: ['Max trades per station', '(default: 3)'],
    },
    guard: {
      hardMaxContracts: ['Hard max contracts/trade', '(default: 20)'],
      maxTradesPerDayPerStation: ['Max trades/day/station', '(default: 1)'],
      minSigmaGap: ['Min σ gap for trade', '(default: 1.5°F)'],
      maxModelSpread: ['Max model spread', '(default: 3.0°F)'],
      maxBidAskSpread: ['Max bid-ask spread', '(default: $0.10)'],
      climOutlierRange: ['Clim outlier range', '(default: 15°F)'],
    },
    execution: {
      autoMaxContracts: ['Auto-execution cap', '(default: 5)'],
      kellyFraction: ['Kelly fraction', '(default: 0.25)'],
      transactionCost: ['Transaction cost/contract', '(default: $0.04)'],
    },
  };

  for (const [section, params] of Object.entries(sections)) {
    console.log(`\n  📋 ${section.toUpperCase()}`);
    for (const [key, [label, def]] of Object.entries(params)) {
      const val = cfg[section]?.[key];
      const display = val != null ? val : '(default)';
      console.log(`     ${label.padEnd(30)} ${String(display).padEnd(8)} ${def}`);
    }
  }

  console.log('\n  Edit: kalshi config set <section.key> <value>');
  console.log('  Reset: kalshi config reset\n');
}
