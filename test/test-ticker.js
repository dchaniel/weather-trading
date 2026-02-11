import { parseTicker } from '../lib/kalshi/markets.js';

let pass = 0, fail = 0;
function assert(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; }
  else { fail++; console.log(`FAIL: ${name}\n  got:    ${JSON.stringify(actual)}\n  expect: ${JSON.stringify(expected)}`); }
}

// Threshold markets
let r = parseTicker('KXHIGHNY-26FEB09-T28');
assert('NYC threshold', r, { category: 'weather', city: 'NY', station: 'KNYC', date: '2026-02-09', threshold: 28, type: 'threshold', semantics: 'above' });

r = parseTicker('KXHIGHCHI-26FEB10-T52');
assert('CHI threshold', r, { category: 'weather', city: 'CHI', station: 'KMDW', date: '2026-02-10', threshold: 52, type: 'threshold', semantics: 'above' });

// Decimal threshold
r = parseTicker('KXHIGHNY-26FEB09-T28.5');
assert('decimal threshold', r?.threshold, 28.5);
assert('decimal type', r?.type, 'threshold');

// Bracket markets
r = parseTicker('KXHIGHMIA-26FEB09-B72.5');
assert('MIA bracket', r?.type, 'bracket');
assert('MIA bracket value', r?.bracket, 72.5);
assert('MIA bracket low', r?.bracketLow, 72);
assert('MIA bracket high', r?.bracketHigh, 73);
assert('MIA bracket city', r?.city, 'MIA');
assert('MIA bracket station', r?.station, 'KMIA');

// Integer bracket
r = parseTicker('KXHIGHCHI-26FEB09-B38');
assert('int bracket low', r?.bracketLow, 38);
assert('int bracket high', r?.bracketHigh, 39);

// Crypto
r = parseTicker('KXBTCD-26FEB09-T100000');
assert('BTC daily', r, { category: 'crypto', coin: 'BTC', period: 'daily', date: '2026-02-09', threshold: 100000, type: 'threshold' });

r = parseTicker('KXETHD-26MAR15-T3500');
assert('ETH daily', r?.coin, 'ETH');

// New cities
r = parseTicker('KXHIGHHOU-26JUL04-T95');
assert('Houston', r?.station, 'KIAH');
assert('Houston city', r?.city, 'HOU');

r = parseTicker('KXHIGHLA-26AUG15-T85');
assert('LA', r?.station, 'KLAX');

r = parseTicker('KXHIGHATL-26MAR01-T60');
assert('Atlanta', r?.station, 'KATL');

// Invalid
assert('null ticker', parseTicker(null), null);
assert('empty', parseTicker(''), null);
assert('garbage', parseTicker('FOOBAR'), null);

console.log(`\n✅ ${pass} passed, ❌ ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
