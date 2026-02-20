#!/usr/bin/env node
/**
 * cron-health.js — Verify all trading tools work end-to-end
 * 
 * Run this to smoke-test every command the cron jobs depend on.
 * Returns exit 0 if all healthy, exit 1 if any failures.
 * Outputs a JSON summary for machine parsing.
 * 
 * Usage: node scripts/cron-health.js [--fix] [--json]
 */

import { execSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const TIMEOUT = 30; // seconds per command
const results = [];
const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const fixMode = args.includes('--fix');

function run(name, cmd, { timeout = TIMEOUT, optional = false } = {}) {
  const start = Date.now();
  try {
    const output = execSync(cmd, { 
      cwd: ROOT, 
      timeout: timeout * 1000, 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    const ms = Date.now() - start;
    results.push({ name, status: 'ok', ms, output: output.slice(0, 200) });
    if (!jsonMode) console.log(`  ✅ ${name} (${ms}ms)`);
    return true;
  } catch (e) {
    const ms = Date.now() - start;
    const error = (e.stderr || e.message || '').slice(0, 200);
    const timedOut = e.killed || error.includes('TIMEOUT');
    results.push({ 
      name, 
      status: timedOut ? 'timeout' : 'error', 
      ms, 
      error,
      optional,
    });
    if (!jsonMode) {
      const icon = optional ? '⚠️' : '❌';
      const reason = timedOut ? `timeout (>${timeout}s)` : error.split('\n')[0];
      console.log(`  ${icon} ${name} (${ms}ms) — ${reason}`);
    }
    return false;
  }
}

function checkFile(name, path) {
  const fullPath = resolve(ROOT, path);
  if (existsSync(fullPath)) {
    const stat = statSync(fullPath);
    const ageHours = (Date.now() - stat.mtimeMs) / 3600000;
    results.push({ name, status: 'ok', ageHours: Math.round(ageHours * 10) / 10 });
    if (!jsonMode) console.log(`  ✅ ${name} (${Math.round(ageHours)}h old)`);
    return true;
  } else {
    results.push({ name, status: 'missing' });
    if (!jsonMode) console.log(`  ❌ ${name} — file not found`);
    return false;
  }
}

async function main() {
  if (!jsonMode) {
    console.log(`\n🏥 Cron Health Check — ${new Date().toISOString()}`);
    console.log('═'.repeat(50));
    console.log('\n📋 Command Tests:\n');
  }

  // Core trading commands
  run('data pipeline (silent)', 'node bin/kalshi.js data pipeline --silent', { timeout: 30 });
  run('data snapshot (silent)', 'node bin/kalshi.js data snapshot --silent', { timeout: 30 });
  run('data collect (silent)', 'node bin/kalshi.js data collect --silent', { timeout: 60 });
  run('perf', 'node bin/kalshi.js perf 2>&1 | head -5', { timeout: 15 });
  run('trade risk', 'node bin/kalshi.js trade risk 2>&1 | head -5', { timeout: 15 });
  run('recommend (dry)', 'node bin/kalshi.js recommend 2>&1 | head -10', { timeout: 30 });
  
  // Tools
  run('gog (gmail)', 'gog gmail search "newer_than:1d" --max 1 --account danielmchan1@gmail.com 2>&1 | head -3', { timeout: 15, optional: true });
  run('gog (calendar)', 'gog calendar list --max 1 --account danielmchan1@gmail.com 2>&1 | head -3', { timeout: 15, optional: true });

  if (!jsonMode) console.log('\n📁 Data Files:\n');

  // Check history files exist and are recent
  checkFile('history dir', 'data/history');
  
  // Check .env
  checkFile('.env', '.env');

  if (!jsonMode) {
    console.log('\n' + '═'.repeat(50));
    const failures = results.filter(r => r.status !== 'ok' && !r.optional);
    const warnings = results.filter(r => r.status !== 'ok' && r.optional);
    console.log(`\n  ${results.filter(r => r.status === 'ok').length} passed, ${failures.length} failed, ${warnings.length} warnings`);
    if (failures.length > 0) {
      console.log(`\n  ❌ FAILURES:`);
      for (const f of failures) {
        console.log(`     ${f.name}: ${f.error?.split('\n')[0] || f.status}`);
      }
    }
    console.log('');
  }

  if (jsonMode) {
    console.log(JSON.stringify({ 
      timestamp: new Date().toISOString(),
      healthy: results.every(r => r.status === 'ok' || r.optional),
      results 
    }));
  }

  const criticalFailures = results.filter(r => r.status !== 'ok' && !r.optional);
  process.exit(criticalFailures.length > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Health check crashed:', e.message);
  process.exit(2);
});
