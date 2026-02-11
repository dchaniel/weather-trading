/**
 * Forecast accuracy statistics from backtest results.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';

const BACKTEST_DIR = new URL('../../data/backtests/', import.meta.url).pathname;

export function loadBacktests() {
  if (!existsSync(BACKTEST_DIR)) return [];
  const files = readdirSync(BACKTEST_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => JSON.parse(readFileSync(BACKTEST_DIR + f, 'utf8')));
}

export function computeStats(backtests = null) {
  const data = backtests || loadBacktests();
  if (!data.length) return null;

  const byStation = {};
  const all = [];

  for (const bt of data) {
    for (const day of (bt.days || [])) {
      const entry = {
        date: day.date,
        station: bt.station,
        forecast: day.forecast,
        actual: day.actual,
        error: day.forecast - day.actual,
      };
      all.push(entry);
      (byStation[bt.station] ||= []).push(entry);
    }
  }

  function stats(entries) {
    if (!entries.length) return null;
    const errors = entries.map(e => e.error);
    const absErrors = errors.map(Math.abs);
    const mae = absErrors.reduce((a, b) => a + b, 0) / absErrors.length;
    const bias = errors.reduce((a, b) => a + b, 0) / errors.length;
    const hits = absErrors.filter(e => e <= 2).length;
    return {
      n: entries.length,
      mae: Math.round(mae * 100) / 100,
      bias: Math.round(bias * 100) / 100,
      hitRate2F: Math.round(hits / entries.length * 1000) / 10,
      maxError: Math.round(Math.max(...absErrors) * 10) / 10,
    };
  }

  const result = { aggregate: stats(all), byStation: {} };
  for (const [station, entries] of Object.entries(byStation)) {
    result.byStation[station] = stats(entries);
  }
  return result;
}
