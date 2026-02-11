/**
 * lib/core/history.js — Append-only JSONL data logger
 * 
 * Generic history pipeline: one function to append, one to read.
 * Files: data/history/{forecasts,observations,markets,decisions,trades}.jsonl
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_DIR = join(__dirname, '../../data/history');
mkdirSync(HISTORY_DIR, { recursive: true });

/** Append a versioned JSON record to a JSONL file */
function appendToJsonl(filename, data) {
  const line = JSON.stringify({ v: 1, ...data }) + '\n';
  writeFileSync(join(HISTORY_DIR, filename), line, { flag: 'a' });
}

/** Read and parse a JSONL file with optional date filtering */
function readHistory(filename, { startDate, endDate } = {}) {
  const filePath = join(HISTORY_DIR, filename);
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf8').trim();
  if (!content) return [];
  let records = content.split('\n').map(line => JSON.parse(line));
  if (startDate || endDate) {
    records = records.filter(r => {
      const d = r.date || r.timestamp?.slice(0, 10);
      if (!d) return true;
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
      return true;
    });
  }
  return records;
}

// ── Type-specific appenders (thin wrappers) ───────────────────────────

export function appendForecast(station, data) {
  appendToJsonl('forecasts.jsonl', {
    date: data.date, station, forecast: data.forecast,
    models: data.models || {}, spread: data.spread,
    climNormal: data.climNormal, climDev: data.climDev,
    timestamp: new Date().toISOString(),
  });
}

export function appendObservation(station, actual, forecastError) {
  appendToJsonl('observations.jsonl', {
    date: new Date().toISOString().slice(0, 10), station, actual, forecastError,
    timestamp: new Date().toISOString(),
  });
}

export function appendMarketSnapshot(station, contracts, marketSigma, ourSigma) {
  const arr = Array.isArray(contracts) ? contracts : [];
  appendToJsonl('markets.jsonl', {
    date: new Date().toISOString().slice(0, 10), station,
    contracts: arr.map(c => ({
      ticker: c.ticker,
      yes_bid: c.yesBid || c.yes_bid || 0,
      yes_ask: c.yesAsk || c.yes_ask || 0,
      volume: c.volume || null,
      impliedSigma: c.impliedSigma,
    })),
    marketSigma, ourSigma,
    sigmaGap: marketSigma && ourSigma ? marketSigma - ourSigma : null,
    timestamp: new Date().toISOString(),
  });
}

export function appendDecision(station, action, guards, netEdge) {
  appendToJsonl('decisions.jsonl', {
    date: new Date().toISOString().slice(0, 10), station, action, guards, netEdge,
    timestamp: new Date().toISOString(),
  });
}

export function appendTrade(data) {
  appendToJsonl('trades.jsonl', {
    date: data.date || new Date().toISOString().slice(0, 10),
    station: data.station, contract: data.contract,
    side: data.side, qty: data.qty, price: data.price,
    expectedEdge: data.expectedEdge,
    marketSigma: data.marketSigma, ourSigma: data.ourSigma,
    timestamp: new Date().toISOString(),
  });
}

// ── Readers ───────────────────────────────────────────────────────────

export function readHistoryFile(file, options = {}) {
  const filename = file.includes('.jsonl') ? file : `${file}.jsonl`;
  return readHistory(filename, options);
}

export function getHistorySummary() {
  const files = ['forecasts', 'observations', 'markets', 'decisions', 'trades'];
  const summary = {};
  for (const f of files) {
    const data = readHistory(`${f}.jsonl`);
    const dates = data.map(r => r.date || r.timestamp?.slice(0, 10)).filter(Boolean).sort();
    summary[f] = {
      totalRecords: data.length,
      dateRange: dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null,
      ...(['forecasts', 'observations', 'markets', 'decisions'].includes(f)
        ? { stations: [...new Set(data.map(r => r.station).filter(Boolean))] }
        : {}),
    };
  }
  return summary;
}
