export function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function formatWatts(value) {
  const watts = toNumber(value);
  if (Math.abs(watts) < 1000) return `${Math.round(watts)} W`;
  return `${(watts / 1000).toFixed(2)} kW`;
}

export function classifyGridFlow(value) {
  const watts = toNumber(value);
  if (Math.abs(watts) < 1) return { direction: 'neutral', watts: 0 };
  return watts > 0
    ? { direction: 'import', watts: Math.abs(watts) }
    : { direction: 'export', watts: Math.abs(watts) };
}

export function peakRisk(loadWatts, thresholdWatts) {
  const threshold = toNumber(thresholdWatts);
  if (threshold <= 0) return { level: 'unknown', ratio: 0 };
  const ratio = Number((toNumber(loadWatts) / threshold).toFixed(2));
  if (ratio >= 1) return { level: 'peak', ratio };
  if (ratio >= 0.8) return { level: 'watch', ratio };
  return { level: 'normal', ratio };
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function readPowerWatts(hass, entityId) {
  if (!entityId || !hass?.states?.[entityId]) return undefined;
  const state = hass.states[entityId];
  const raw = toNumber(state.state, undefined);
  if (raw === undefined) return undefined;
  const unit = String(state.attributes?.unit_of_measurement || 'W').toLowerCase();
  if (unit === 'kw') return raw * 1000;
  if (unit === 'mw') return raw * 1000000;
  return raw;
}
