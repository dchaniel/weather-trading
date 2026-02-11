/**
 * Kalshi market data — delegates to the authenticated client.
 * Robust ticker parsing for all temperature market formats.
 */

export { getTemperatureMarkets as fetchMarkets, getMarket, getMarkets, getEvents, getSeriesMarkets } from './client.js';

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
                 JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };

// City code mapping: ticker suffix → station key
const CITY_MAP = {
  NY:  'KNYC',
  CHI: 'KMDW',
  MIA: 'KMIA',
  DEN: 'KDEN',
  HOU: 'KIAH',
  LA:  'KLAX',
  ATL: 'KATL',
  DFW: 'KDFW',
  PHX: 'KPHX',
  SEA: 'KSEA',
  BOS: 'KBOS',
  MSP: 'KMSP',
  DCA: 'KDCA',
  DTW: 'KDTW',
  PHL: 'KPHL',
  SF:  'KSFO',
};

// Low-temp tickers use different city codes (e.g., KXLOWTNYC not KXLOWTNY)
const LOW_CITY_MAP = {
  NYC:  'KNYC',
  CHI:  'KMDW',
  MIA:  'KMIA',
  DEN:  'KDEN',
  AUS:  'KAUS',
  PHIL: 'KPHL',
};

/**
 * Parse a Kalshi ticker to extract components.
 * 
 * Supported formats:
 *   Weather threshold: KXHIGHNY-26FEB10-T52, KXHIGHNY-26FEB09-T28
 *   Weather bracket:   KXHIGHMIA-26FEB09-B72.5
 *   Decimal threshold: KXHIGHNY-26FEB09-T28.5
 *   Crypto threshold:  KXBTCD-26FEB09-T100000
 */
export function parseTicker(ticker) {
  if (!ticker) return null;

  // Weather: KXHIGH<CITY>-<YY><MON><DD>-<T|B><value>
  const wxMatch = ticker.match(/^KXHIGH([A-Z]+)-(\d{2})([A-Z]{3})(\d{2})-(T|B)([\d.]+)$/);
  if (wxMatch) {
    const [, city, yy, mon, dd, typeChar, valStr] = wxMatch;
    const monthNum = MONTHS[mon];
    if (!monthNum) return null;
    const value = parseFloat(valStr);
    const date = `20${yy}-${monthNum}-${dd}`;
    const station = CITY_MAP[city] || null;

    if (typeChar === 'T') {
      return {
        category: 'weather',
        city,
        station,
        date,
        threshold: value,
        type: 'threshold',
        // Threshold markets: YES = high temp >= threshold
        semantics: 'above',
      };
    } else {
      // Bracket: B72.5 means the 72-73°F range (or 72.5-73.5 depending on market)
      return {
        category: 'weather',
        city,
        station,
        date,
        bracket: value,
        bracketLow: Math.floor(value),
        bracketHigh: Math.ceil(value) + (value === Math.floor(value) ? 1 : 0),
        type: 'bracket',
      };
    }
  }

  // Weather low temp: KXLOWT<CITY>-<YY><MON><DD>-<T|B><value>
  const lowMatch = ticker.match(/^KXLOWT([A-Z]+)-(\d{2})([A-Z]{3})(\d{2})-(T|B)([\d.]+)$/);
  if (lowMatch) {
    const [, city, yy, mon, dd, typeChar, valStr] = lowMatch;
    const monthNum = MONTHS[mon];
    if (!monthNum) return null;
    const value = parseFloat(valStr);
    const date = `20${yy}-${monthNum}-${dd}`;
    const station = LOW_CITY_MAP[city] || CITY_MAP[city] || null;

    if (typeChar === 'T') {
      return {
        category: 'weather',
        tempType: 'low',
        city,
        station,
        date,
        threshold: value,
        type: 'threshold',
        semantics: 'above',
      };
    } else {
      return {
        category: 'weather',
        tempType: 'low',
        city,
        station,
        date,
        bracket: value,
        bracketLow: Math.floor(value),
        bracketHigh: Math.ceil(value) + (value === Math.floor(value) ? 1 : 0),
        type: 'bracket',
      };
    }
  }

  // Crypto: KX<COIN><PERIOD>-<YY><MON><DD>-T<value>
  const cMatch = ticker.match(/^KX(BTC|ETH)([DW]?)-(\d{2})([A-Z]{3})(\d{2})-T(\d+)$/);
  if (cMatch) {
    const [, coin, period, yy, mon, dd, valStr] = cMatch;
    const monthNum = MONTHS[mon];
    if (!monthNum) return null;
    return {
      category: 'crypto',
      coin,
      period: period === 'W' ? 'weekly' : 'daily',
      date: `20${yy}-${monthNum}-${dd}`,
      threshold: parseInt(valStr),
      type: 'threshold',
    };
  }

  return null;
}
