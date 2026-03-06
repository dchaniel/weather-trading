/**
 * NWS observation fetcher — gets actual high/low temps for a station + date.
 *
 * IMPORTANT: Kalshi settles weather markets based on calendar-day highs in
 * LOCAL time.  We must query observations using the station's local-time day
 * boundaries converted to UTC, otherwise west-coast / central stations miss
 * daytime hours and return incorrect highs (the old code used a fixed UTC
 * window that only captured evening/night observations for most US stations).
 */

import { STATIONS } from './stations.js';
import { fetchJSON, cToF, round1 } from '../core/utils.js';

/**
 * Map of station prefixes → IANA timezone.
 * Covers all stations currently in STATIONS.
 */
const STATION_TZ = {
  KNYC: 'America/New_York',
  KPHL: 'America/New_York',
  KMIA: 'America/New_York',
  KATL: 'America/New_York',
  KDCA: 'America/New_York',
  KMDW: 'America/Chicago',
  KIAH: 'America/Chicago',
  KDFW: 'America/Chicago',
  KOKC: 'America/Chicago',
  KAUS: 'America/Chicago',
  KMSP: 'America/Chicago',
  KDEN: 'America/Denver',
  KLAX: 'America/Los_Angeles',
  KSFO: 'America/Los_Angeles',
  KSEA: 'America/Los_Angeles',
};

/**
 * Get UTC offset (in hours) for a timezone on a given date.
 * Returns e.g. -5 for EST, -8 for PST.
 */
function getUtcOffsetHours(tz, dateStr) {
  // Create a date at noon local to avoid DST edge cases
  const dt = new Date(`${dateStr}T12:00:00`);
  const utcStr = dt.toLocaleString('en-US', { timeZone: 'UTC' });
  const localStr = dt.toLocaleString('en-US', { timeZone: tz });
  const utcMs = new Date(utcStr).getTime();
  const localMs = new Date(localStr).getTime();
  return (localMs - utcMs) / 3600000;
}

export async function fetchObservation(station, date) {
  const s = STATIONS[station];
  const tz = STATION_TZ[station] || 'America/New_York'; // safe default

  // Convert local midnight→midnight+1day to UTC
  const offsetHrs = getUtcOffsetHours(tz, date);
  // Local 00:00 = UTC 00:00 - offset  (offset is negative for US)
  const startUTC = new Date(`${date}T00:00:00Z`);
  startUTC.setHours(startUTC.getHours() - offsetHrs);

  const endUTC = new Date(startUTC);
  endUTC.setHours(endUTC.getHours() + 24);

  const start = startUTC.toISOString();
  const end = endUTC.toISOString();

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
