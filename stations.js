// Settlement station metadata
// All temperatures in °F. Climatological normals are approximate Feb averages.

export const STATIONS = {
  KNYC: {
    name: 'Central Park, NYC',
    lat: 40.7789,
    lon: -73.9692,
    nwsOffice: 'OKX',
    nwsGridX: 33,
    nwsGridY: 37,
    observationStation: 'KNYC',
    // Feb climatological normals (avg high / avg low)
    climNormalHigh: { 1: 39, 2: 40, 3: 48, 4: 62, 5: 72, 6: 80, 7: 85, 8: 84, 9: 77, 10: 65, 11: 54, 12: 42 },
    climNormalLow:  { 1: 27, 2: 28, 3: 35, 4: 45, 5: 55, 6: 65, 7: 70, 8: 69, 9: 62, 10: 51, 11: 42, 12: 32 },
    bias: -1, // Central Park reads ~1°F cooler than city average (shaded, park microclimate)
  },
  KMDW: {
    name: 'Chicago Midway',
    lat: 41.7861,
    lon: -87.7522,
    nwsOffice: 'LOT',
    nwsGridX: 75,
    nwsGridY: 68,
    observationStation: 'KMDW',
    climNormalHigh: { 1: 32, 2: 36, 3: 47, 4: 59, 5: 70, 6: 80, 7: 84, 8: 82, 9: 75, 10: 62, 11: 48, 12: 35 },
    climNormalLow:  { 1: 19, 2: 23, 3: 32, 4: 42, 5: 52, 6: 63, 7: 68, 8: 67, 9: 59, 10: 47, 11: 35, 12: 23 },
    bias: +2, // Urban heat island at Midway
  },
  KMIA: {
    name: 'Miami International',
    lat: 25.7959,
    lon: -80.2870,
    nwsOffice: 'MFL',
    nwsGridX: 109,
    nwsGridY: 50,
    observationStation: 'KMIA',
    climNormalHigh: { 1: 77, 2: 78, 3: 80, 4: 83, 5: 87, 6: 90, 7: 91, 8: 91, 9: 90, 10: 86, 11: 82, 12: 78 },
    climNormalLow:  { 1: 61, 2: 62, 3: 65, 4: 68, 5: 73, 6: 76, 7: 77, 8: 77, 9: 76, 10: 73, 11: 67, 12: 63 },
    bias: 0,
  },
  KDEN: {
    name: 'Denver International',
    lat: 39.8561,
    lon: -104.6737,
    nwsOffice: 'BOU',
    nwsGridX: 62,
    nwsGridY: 60,
    observationStation: 'KDEN',
    climNormalHigh: { 1: 44, 2: 45, 3: 53, 4: 60, 5: 69, 6: 81, 7: 88, 8: 86, 9: 77, 10: 64, 11: 52, 12: 43 },
    climNormalLow:  { 1: 17, 2: 19, 3: 26, 4: 34, 5: 43, 6: 52, 7: 58, 8: 56, 9: 47, 10: 35, 11: 25, 12: 17 },
    bias: 0,
    notes: 'Chinook events cause rapid warming; inversions trap cold air',
  },
};

// How far from climatological normal is "suspicious"
export const CLIM_OUTLIER_THRESHOLD_F = 15;

// Max allowed spread between forecast sources to trade
export const MAX_MODEL_SPREAD_F = 2;
