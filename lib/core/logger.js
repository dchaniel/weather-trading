/**
 * Simple file logger — append to data/logs/wt.log.
 * Zero dependencies, just fs.
 */

import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const LOG_PATH = new URL('../../data/logs/wt.log', import.meta.url).pathname;

// Ensure log directory exists
try { mkdirSync(dirname(LOG_PATH), { recursive: true }); } catch (e) {
  console.error(`Warning: Failed to create log directory: ${e.message}`);
}

function fmt(level, category, message, data) {
  const ts = new Date().toISOString();
  const line = { ts, level, category, message, ...data };
  return JSON.stringify(line);
}

function write(line) {
  try { appendFileSync(LOG_PATH, line + '\n'); } catch (e) {
    console.error(`Warning: Failed to write log: ${e.message}`);
  }
}

export function logInfo(category, message, data = {}) {
  write(fmt('INFO', category, message, data));
}

export function logWarn(category, message, data = {}) {
  write(fmt('WARN', category, message, data));
}

export function logError(category, message, data = {}) {
  write(fmt('ERROR', category, message, data));
}

export function logTrade(action, trade) {
  write(fmt('INFO', 'trade', action, { trade }));
}

export function logSettlement(date, results) {
  write(fmt('INFO', 'settlement', `Settled ${results.length} trades for ${date}`, { date, count: results.length }));
}
