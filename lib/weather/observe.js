/**
 * NWS observation fetcher — gets actual high/low temps for a station + date.
 */

import { STATIONS } from './stations.js';
import { fetchJSON, cToF, round1 } from '../core/utils.js';

export async function fetchObservation(station, date) {
  const s = STATIONS[station];
  const start = `${date}T00:00:00Z`;
  const next = new Date(date + 'T00:00:00Z');
  next.setDate(next.getDate() + 1);
  const end = next.toISOString().slice(0, 10) + 'T06:00:00Z';

  const url = `https://api.weather.gov/stations/${s.observationStation}/observations?start=${start}&end=${end}`;
  const data = await fetchJSON(url);
  const features = data.features || [];
  if (!features.length) return null;

  const temps = features
    .map(f => f.properties?.temperature?.value)
    .filter(t => t != null);
  if (!temps.length) return null;

  const maxC = Math.max(...temps);
  const minC = Math.min(...temps);

  return {
    station, date,
    observations: temps.length,
    high_f: round1(cToF(maxC)),
    low_f: round1(cToF(minC)),
    high_c: round1(maxC),
    low_c: round1(minC),
  };
}
