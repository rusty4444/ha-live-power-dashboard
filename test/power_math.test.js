import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyGridFlow, escapeHtml, formatWatts, peakRisk, readPowerWatts } from '../src/power_math.js';

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
