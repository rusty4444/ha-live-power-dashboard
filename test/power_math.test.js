import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyGridFlow, escapeHtml, formatWatts, peakRisk, readPowerWatts, recordRollingSample, rollingWindowStats, predictDemandRisk, formatPredictionSummary } from '../src/power_math.js';

// Minimal localStorage mock for Node.js tests
const store = {};
global.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
};

test('formatWatts formats watts and kilowatts', () => {
  assert.equal(formatWatts(999), '999 W');
  assert.equal(formatWatts(1250), '1.25 kW');
  assert.equal(formatWatts(-3500), '-3.50 kW');
});

test('classifyGridFlow separates import export and neutral', () => {
  assert.deepEqual(classifyGridFlow(120), { direction: 'import', watts: 120 });
  assert.deepEqual(classifyGridFlow(-50), { direction: 'export', watts: 50 });
  assert.deepEqual(classifyGridFlow(0.3), { direction: 'neutral', watts: 0 });
});

test('peakRisk computes threshold status', () => {
  assert.deepEqual(peakRisk(4200, 5000), { level: 'watch', ratio: 0.84 });
  assert.deepEqual(peakRisk(5200, 5000), { level: 'peak', ratio: 1.04 });
  assert.deepEqual(peakRisk(1000, 0), { level: 'unknown', ratio: 0 });
  assert.deepEqual(peakRisk(0, 5000), { level: 'normal', ratio: 0 });
});

test('escapeHtml escapes Lovelace config strings before template insertion', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml('A&B "C"'), 'A&amp;B &quot;C&quot;');
});

test('readPowerWatts converts HA power sensor units', () => {
  const hass = {
    states: {
      'sensor.watts': { state: '450', attributes: { unit_of_measurement: 'W' } },
      'sensor.kw': { state: '1.5', attributes: { unit_of_measurement: 'kW' } },
      'sensor.mw': { state: '0.002', attributes: { unit_of_measurement: 'MW' } },
    },
  };
  assert.equal(readPowerWatts(hass, 'sensor.watts'), 450);
  assert.equal(readPowerWatts(hass, 'sensor.kw'), 1500);
  assert.equal(readPowerWatts(hass, 'sensor.mw'), 2000);
  assert.equal(readPowerWatts(hass, 'sensor.missing'), undefined);
});

test('recordRollingSample stores and prunes data in localStorage', () => {
  // Clear any prior data
  localStorage.removeItem('lpd_rolling_load');
  const now = Date.now();
  const d1 = recordRollingSample('load', 1200, now);
  assert.equal(d1.length, 1);
  assert.equal(d1[0].w, 1200);
  const d2 = recordRollingSample('load', 1300, now + 60000);
  assert.equal(d2.length, 2);
  // Old data (>48h) should be pruned
  const old = now - 49 * 60 * 60 * 1000;
  recordRollingSample('load', 999, old);
  const d3 = recordRollingSample('load', 1400, now + 120000);
  assert.equal(d3.length, 3);
  assert.equal(d3[0].w, 1200); // old entry pruned
  localStorage.removeItem('lpd_rolling_load');
});

test('rollingWindowStats computes basic stats', () => {
  const samples = [
    { t: 100000, w: 1000 },
    { t: 1060000, w: 2000 },
    { t: 2060000, w: 3000 }, // outside 30m window from last
  ];
  // 30m window from last sample
  const stats = rollingWindowStats(samples, 30 * 60 * 1000);
  assert.equal(stats.samplesInWindow, 2);
  assert.equal(stats.average, 2500);
  assert.equal(stats.peak, 3000);
  assert.equal(stats.current, 3000);
});

test('rollingWindowStats empty array returns zeros', () => {
  const stats = rollingWindowStats([], 60000);
  assert.equal(stats.samplesInWindow, 0);
  assert.equal(stats.average, 0);
});

test('rollingWindowStats detects rising trend', () => {
  const now = Date.now();
  const samples = [];
  for (let i = 0; i < 25; i++) {
    samples.push({ t: now - (25 - i) * 60000, w: 1000 + i * 100 });
  }
  const stats = rollingWindowStats(samples, 30 * 60 * 1000);
  assert.equal(stats.trend, 'rising');
  assert.ok(stats.projectedPeak >= stats.current);
});

test('predictDemandRisk returns high confidence for clear breach', () => {
  const stats = { average: 4500, peak: 5200, current: 4800, trend: 'rising', projectedPeak: 5500, samplesInWindow: 80 };
  const pred = predictDemandRisk(stats, 5000);
  assert.equal(pred.willExceed, true);
  assert.equal(pred.confidence, 'high');
  assert.equal(pred.projectedExcessWatts, 500);
});

test('predictDemandRisk low confidence with insufficient data', () => {
  const stats = { average: 1000, peak: 1200, current: 1100, trend: 'stable', projectedPeak: 1150, samplesInWindow: 3 };
  const pred = predictDemandRisk(stats, 5000);
  assert.equal(pred.willExceed, false);
  assert.equal(pred.confidence, 'low');
});

test('predictDemandRisk no threshold returns safe', () => {
  const stats = { average: 1000, peak: 1200, current: 1100, trend: 'stable', projectedPeak: 1150, samplesInWindow: 50 };
  const pred = predictDemandRisk(stats, 0);
  assert.equal(pred.willExceed, false);
  assert.equal(pred.confidence, 'low');
});

test('formatPredictionSummary formats breach', () => {
  const pred = { willExceed: true, confidence: 'medium', projectedExcessWatts: 750, minutesToProjected: 15 };
  const s = formatPredictionSummary(pred);
  assert.ok(s.includes('750'));
  assert.ok(s.includes('medium'));
  assert.ok(s.includes('15 min'));
});

test('formatPredictionSummary safe case', () => {
  assert.equal(formatPredictionSummary({ willExceed: false }), 'No breach predicted');
});
