/**
 * lib/flights/data.js — FAA delay data and FlightAware delay/cancellation fetcher.
 * 
 * Data sources:
 * 1. FAA NASSTATUS API — real-time ground delay programs, airport closures
 * 2. FlightAware — historical delay/cancellation counts (settlement source for FLIGHTORD)
 * 3. Open-Meteo — weather at ORD (reuses existing weather pipeline via KMDW coords)
 * 
 * Contract structures discovered:
 * - ORDDLY (KXORDDLY): Binary — "Will ORD departures be delayed on [day] morning?"
 *   YES = avg delays ≥ 15 min. Settled via FAA.
 * - FLIGHTORD: Total delays+cancellations at ORD. Settled via FlightAware.
 *   Threshold contracts: total > X.
 */

import { fetchJSON, today } from '../core/utils.js';

// ── ORD coordinates (O'Hare) ────────────────────────────────────────────────
export const ORD = {
  lat: 41.9742,
  lon: -87.9073,
  icao: 'KORD',
  faa: 'ORD',
  name: "O'Hare International Airport",
};

// ── FAA NASSTATUS — Real-time ground delay programs ─────────────────────────

/**
 * Fetch current FAA airport status for ORD.
 * Returns { hasDelay, groundDelay, closures, raw }.
 * Free API, no key needed.
 */
export async function fetchFAAStatus() {
  const url = 'https://nasstatus.faa.gov/api/airport-status-information';
  const text = await fetch(url, {
    headers: { 'User-Agent': 'kalshi-trading/3.0' },
  }).then(r => r.text());

  const groundDelays = [];
  const gdpRegex = /<Ground_Delay>.*?<ARPT>(.*?)<\/ARPT>.*?<Reason>(.*?)<\/Reason>.*?<Avg>(.*?)<\/Avg>.*?<Max>(.*?)<\/Max>.*?<\/Ground_Delay>/gs;
  let match;
  while ((match = gdpRegex.exec(text))) {
    groundDelays.push({ airport: match[1], reason: match[2], avg: match[3], max: match[4] });
  }

  const closures = [];
  const closureRegex = /<Airport>.*?<ARPT>(.*?)<\/ARPT>.*?<Reason>(.*?)<\/Reason>.*?<\/Airport>/gs;
  while ((match = closureRegex.exec(text))) {
    closures.push({ airport: match[1], reason: match[2] });
  }

  const ordDelay = groundDelays.find(d => d.airport === 'ORD');
  const ordClosed = closures.find(c => c.airport === 'ORD');

  return {
    hasDelay: !!ordDelay,
    isClosed: !!ordClosed,
    groundDelay: ordDelay || null,
    allDelays: groundDelays,
    allClosures: closures,
    timestamp: new Date().toISOString(),
  };
}

// ── Weather at ORD via Open-Meteo ───────────────────────────────────────────

/**
 * Fetch weather forecast for ORD. Returns key delay-relevant features.
 * Reuses Open-Meteo (same as existing weather strategy).
 */
export async function fetchORDWeather(date) {
  const url = `https://api.open-meteo.com/v1/gfs?latitude=${ORD.lat}&longitude=${ORD.lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,` +
    `wind_speed_10m_max,wind_gusts_10m_max,weather_code` +
    `&hourly=visibility,wind_speed_10m,precipitation,snowfall,weather_code,cloud_cover` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph` +
    `&start_date=${date}&end_date=${date}&timezone=America%2FChicago`;

  const data = await fetchJSON(url);
  const daily = data.daily || {};
  const hourly = data.hourly || {};

  // Extract delay-relevant features
  const visibility = hourly.visibility || [];
  const windSpeeds = hourly.wind_speed_10m || [];
  const precip = hourly.precipitation || [];
  const snowfall = hourly.snowfall || [];
  const weatherCodes = hourly.weather_code || [];
  const cloudCover = hourly.cloud_cover || [];

  // Compute summary features
  const minVisibility = visibility.length ? Math.min(...visibility) : 99999;
  const avgVisibility = visibility.length ? visibility.reduce((a, b) => a + b, 0) / visibility.length : 99999;
  const maxWind = windSpeeds.length ? Math.max(...windSpeeds) : 0;
  const avgWind = windSpeeds.length ? windSpeeds.reduce((a, b) => a + b, 0) / windSpeeds.length : 0;
  const totalPrecip = precip.reduce((a, b) => a + b, 0);
  const totalSnow = snowfall.reduce((a, b) => a + b, 0);
  const maxCloudCover = cloudCover.length ? Math.max(...cloudCover) : 0;

  // Thunderstorm detection (WMO codes 95-99)
  const hasThunderstorm = weatherCodes.some(c => c >= 95);
  // Freezing rain (WMO codes 66-67)
  const hasFreezingRain = weatherCodes.some(c => c >= 66 && c <= 67);
  // Fog (WMO codes 45, 48)
  const hasFog = weatherCodes.some(c => c === 45 || c === 48);
  // Snow (WMO codes 71-77, 85-86)
  const hasSnow = weatherCodes.some(c => (c >= 71 && c <= 77) || (c >= 85 && c <= 86));

  return {
    date,
    highF: daily.temperature_2m_max?.[0],
    lowF: daily.temperature_2m_min?.[0],
    maxWindMph: Math.round(daily.wind_gusts_10m_max?.[0] || maxWind),
    avgWindMph: Math.round(avgWind),
    totalPrecipMm: Math.round(totalPrecip * 10) / 10,
    totalSnowCm: Math.round(totalSnow * 10) / 10,
    minVisibilityM: Math.round(minVisibility),
    avgVisibilityM: Math.round(avgVisibility),
    maxCloudCover,
    hasThunderstorm,
    hasFreezingRain,
    hasFog,
    hasSnow,
    dailyWeatherCode: daily.weather_code?.[0],
    hourlyDetail: { visibility, windSpeeds, precip, snowfall, weatherCodes, cloudCover },
  };
}

// ── FlightAware scraping (for historical calibration) ───────────────────────

/**
 * Fetch FlightAware delay/cancellation counts for ORD on a given date.
 * Note: FlightAware may require parsing HTML. For calibration we use
 * pre-compiled historical statistics instead.
 */
export async function fetchFlightAwareORD(date) {
  // FlightAware doesn't have a free API. For real-time, we rely on FAA status.
  // For historical calibration, we use BTS statistics compiled in model.js.
  const url = `https://flightaware.com/live/cancelled/${date}/KORD`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; kalshi-trading/3.0)' },
    });
    if (!res.ok) return null;
    // FlightAware returns HTML; basic extraction
    const html = await res.text();
    const cancelMatch = html.match(/(\d+)\s+cancell?ations?/i);
    const delayMatch = html.match(/(\d+)\s+delays?/i);
    return {
      date,
      cancellations: cancelMatch ? parseInt(cancelMatch[1]) : null,
      delays: delayMatch ? parseInt(delayMatch[1]) : null,
      source: 'flightaware',
    };
  } catch {
    return null;
  }
}

// ── Historical delay statistics (BTS/FAA compiled) ──────────────────────────

/**
 * ORD historical delay statistics from BTS On-Time Performance data.
 * These are calibrated base rates by month and day-of-week.
 * 
 * Source: BTS Airline On-Time Statistics (2019-2024 averages, excluding 2020 COVID).
 * ORD is consistently one of the most delay-prone US airports.
 * 
 * Values represent P(avg departure delay ≥ 15 min) — the ORDDLY settlement criterion.
 */
export const ORD_DELAY_BASE_RATES = {
  // Monthly base rates: P(significant delay day) from BTS data
  // Winter: weather delays (snow, ice, low visibility)
  // Summer: thunderstorm delays + volume
  monthly: {
    1: 0.28,  // Jan: snow/ice
    2: 0.26,  // Feb: snow/ice
    3: 0.22,  // Mar: transitional
    4: 0.18,  // Apr: spring storms begin
    5: 0.20,  // May: thunderstorms ramp up
    6: 0.32,  // Jun: peak thunderstorm season
    7: 0.35,  // Jul: peak delays (thunderstorms + volume)
    8: 0.30,  // Aug: still high thunderstorm risk
    9: 0.18,  // Sep: calming down
    10: 0.14, // Oct: best month
    11: 0.20, // Nov: early winter + holiday travel
    12: 0.30, // Dec: winter storms + holiday volume
  },

  // Day-of-week multipliers (1=Mon, 7=Sun). Fridays and Sundays are worst.
  dayOfWeek: {
    1: 1.05,  // Monday: business travel
    2: 0.90,  // Tuesday: lightest
    3: 0.95,  // Wednesday: moderate
    4: 1.05,  // Thursday: pre-weekend
    5: 1.15,  // Friday: heavy departures
    6: 0.85,  // Saturday: lightest
    7: 1.10,  // Sunday: return travel
  },

  // Holiday multipliers (applied on top of month + DOW)
  holidays: {
    // Major travel holidays with +20-40% delay increase
    'thanksgiving_week': 1.35,
    'christmas_week': 1.30,
    'new_years': 1.20,
    'memorial_day': 1.15,
    'labor_day': 1.15,
    'july_4th': 1.20,
    'spring_break': 1.10,
  },

  // Average daily flights at ORD (for FLIGHTORD total count modeling)
  avgDailyFlights: 2400,
  // Typical delay+cancellation counts by severity
  delayCountDistribution: {
    // P(total delays+cancellations in range) — for FLIGHTORD threshold markets
    clear: { mean: 180, std: 60 },       // Good weather day
    moderate: { mean: 350, std: 100 },    // Some weather issues
    severe: { mean: 650, std: 150 },      // Major weather event
    extreme: { mean: 1000, std: 200 },    // Blizzard/derecho level
  },
};

/**
 * Check if a date falls on/near a major holiday.
 * Returns the holiday multiplier or 1.0 if no holiday.
 */
export function getHolidayMultiplier(date) {
  const d = new Date(date + 'T12:00:00Z');
  const month = d.getMonth() + 1;
  const day = d.getDate();

  // Thanksgiving: 4th Thursday of November ± 3 days
  if (month === 11) {
    // Find 4th Thursday
    const firstDay = new Date(d.getFullYear(), 10, 1).getDay();
    const firstThurs = firstDay <= 4 ? 5 - firstDay : 12 - firstDay;
    const thanksgiving = firstThurs + 21;
    if (Math.abs(day - thanksgiving) <= 3) return ORD_DELAY_BASE_RATES.holidays.thanksgiving_week;
  }

  // Christmas: Dec 20-31
  if (month === 12 && day >= 20) return ORD_DELAY_BASE_RATES.holidays.christmas_week;
  // New Year: Jan 1-3
  if (month === 1 && day <= 3) return ORD_DELAY_BASE_RATES.holidays.new_years;
  // July 4th: Jul 2-5
  if (month === 7 && day >= 2 && day <= 5) return ORD_DELAY_BASE_RATES.holidays.july_4th;
  // Memorial Day: last Monday of May ± 2
  if (month === 5 && day >= 24) return ORD_DELAY_BASE_RATES.holidays.memorial_day;
  // Labor Day: first Monday of Sept ± 2
  if (month === 9 && day <= 7) return ORD_DELAY_BASE_RATES.holidays.labor_day;

  return 1.0;
}
