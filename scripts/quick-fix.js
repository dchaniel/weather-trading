#!/usr/bin/env node
/**
 * quick-fix.js — Auto-fix common cron failure patterns
 * 
 * Usage: node scripts/quick-fix.js
 * 
 * Checks for and fixes:
 * 1. "snapshot is not defined" in data.js
 * 2. Stale node processes hogging resources
 * 3. Missing data directories
 * 4. Corrupted JSONL history files
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let fixes = 0;

function log(msg) { console.log(`  ${msg}`); }

// Fix 1: "snapshot is not defined" in data.js
function fixSnapshotBug() {
  const dataJs = resolve(ROOT, 'commands/data.js');
  if (!existsSync(dataJs)) return;
  const content = readFileSync(dataJs, 'utf8');
  if (content.includes('return snapshot;')) {
    log('🔧 Fixing "snapshot is not defined" in data.js → "return results;"');
    writeFileSync(dataJs, content.replace('return snapshot;', 'return results;'));
    fixes++;
  }
}

// Fix 2: Kill stale kalshi processes (>5 min old)
function killStaleProcesses() {
  try {
    const ps = execSync('ps aux | grep "kalshi.js" | grep -v grep', { encoding: 'utf8', timeout: 5000 });
    const lines = ps.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const parts = line.split(/\s+/);
      const pid = parts[1];
      const time = parts[9]; // CPU time
      // Kill processes running >5 min
      if (time && time.includes(':') && parseInt(time.split(':')[0]) >= 5) {
        log(`🔧 Killing stale kalshi process PID ${pid} (running ${time})`);
        try { execSync(`kill ${pid}`); fixes++; } catch {}
      }
    }
  } catch { /* no stale processes */ }
}

// Fix 3: Ensure data directories exist
function ensureDirectories() {
  const dirs = ['data', 'data/history', 'data/forecasts', 'data/snapshots'];
  for (const dir of dirs) {
    const path = resolve(ROOT, dir);
    if (!existsSync(path)) {
      log(`🔧 Creating missing directory: ${dir}/`);
      mkdirSync(path, { recursive: true });
      fixes++;
    }
  }
}

// Fix 4: Check JSONL files for corruption (trailing commas, broken JSON)
function checkJsonlHealth() {
  const historyDir = resolve(ROOT, 'data/history');
  if (!existsSync(historyDir)) return;
  
  const files = readdirSync(historyDir).filter(f => f.endsWith('.jsonl'));
  for (const file of files) {
    const path = resolve(historyDir, file);
    try {
      const content = readFileSync(path, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      let badLines = 0;
      for (const line of lines) {
        try { JSON.parse(line); } catch { badLines++; }
      }
      if (badLines > 0) {
        log(`⚠️ ${file}: ${badLines}/${lines.length} corrupted lines`);
        // Don't auto-fix JSONL — just report
      }
    } catch (e) {
      log(`⚠️ ${file}: unreadable — ${e.message}`);
    }
  }
}

console.log(`\n🔧 Quick Fix — ${new Date().toISOString()}`);
console.log('═'.repeat(40));

fixSnapshotBug();
killStaleProcesses();
ensureDirectories();
checkJsonlHealth();

console.log(`\n  ${fixes} fix${fixes !== 1 ? 'es' : ''} applied.\n`);
process.exit(0);
