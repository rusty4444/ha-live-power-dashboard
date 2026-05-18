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

/* ─── rolling-window demand-tariff prediction ─── */

/**
 * Append a timestamped sample to a rolling window stored in localStorage.
 * Returns the updated window array.
 */
export function recordRollingSample(entityId, watts, now = Date.now()) {
  const key = `lpd_rolling_${entityId}`;
  try {
    const raw = localStorage.getItem(key);
    const window = raw ? JSON.parse(raw) : [];
    window.push({ t: now, w: Math.round(watts) });
    // Keep at most 48 hours of data (2880 entries at 60s intervals)
    const cutoff = now - 48 * 60 * 60 * 1000;
    const pruned = window.filter((s) => s.t >= cutoff);
    localStorage.setItem(key, JSON.stringify(pruned));
    return pruned;
  } catch {
    // Corrupted localStorage data — start fresh
    const fresh = [{ t: now, w: Math.round(watts) }];
    localStorage.setItem(key, JSON.stringify(fresh));
    return fresh;
  }
}

/**
 * Compute rolling-window statistics from an array of {t, w} samples.
 *
 * @param {Array<{t:number, w:number}>} samples  Time-stamped power readings
 * @param {number} windowMs  Look-back window in ms (default 30 min)
 * @returns {{ average: number, peak: number, current: number, trend: 'rising'|'falling'|'stable', projectedPeak: number, samplesInWindow: number }}
 */
export function rollingWindowStats(samples, windowMs = 30 * 60 * 1000) {
  if (!samples || samples.length === 0) {
    return {
      average: 0, peak: 0, current: 0, trend: 'stable',
      projectedPeak: 0, samplesInWindow: 0,
    };
  }
  const now = samples[samples.length - 1].t;
  const inWindow = samples.filter((s) => s.t >= now - windowMs);
  if (inWindow.length === 0) {
    return {
      average: 0, peak: 0, current: 0, trend: 'stable',
      projectedPeak: 0, samplesInWindow: 0,
    };
  }

  const values = inWindow.map((s) => s.w);
  const current = values[values.length - 1];
  const sum = values.reduce((a, b) => a + b, 0);
  const average = sum / values.length;
  const peak = Math.max(...values);

  // Simple linear regression to detect trend
  const n = inWindow.length;
  const meanI = (n - 1) / 2;
  const meanV = average;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const di = i - meanI;
    const dv = values[i] - meanV;
    num += di * dv;
    den += di * di;
  }
  const slope = den > 0 ? num / den : 0;
  const trend = slope > 0.5 ? 'rising' : slope < -0.5 ? 'falling' : 'stable';

  // Project the value at the end of the window using the slope.
  // Guard against division by zero when two samples share the same timestamp.
  const stepInterval = Math.max(1000, now - (inWindow.length > 1 ? inWindow[inWindow.length - 2].t : 60000));
  const remainingSteps = Math.max(0, windowMs / stepInterval - n);
  const projectedPeak = Math.max(current, current + slope * remainingSteps);

  return {
    average: Math.round(average),
    peak,
    current,
    trend,
    projectedPeak: Math.max(0, Math.round(projectedPeak)),
    samplesInWindow: inWindow.length,
  };
}

/**
 * Predict demand-tariff risk given rolling window stats and a threshold.
 *
 * @param {{ average: number, peak: number, current: number, trend: string, projectedPeak: number }} stats
 * @param {number} thresholdWatts  Demand threshold in watts
 * @returns {{ willExceed: boolean, confidence: 'high'|'medium'|'low', projectedExcessWatts: number, minutesToProjected: number|null }}
 */
export function predictDemandRisk(stats, thresholdWatts) {
  const t = toNumber(thresholdWatts, 0);
  if (t <= 0 || stats.samplesInWindow < 5) {
    return { willExceed: false, confidence: 'low', projectedExcessWatts: 0, minutesToProjected: null };
  }

  const projectedExcess = Math.max(0, stats.projectedPeak - t);
  const willExceed = projectedExcess > 0;

  // Confidence heuristic: lots of data + clear trend = high confidence
  let confidence = 'low';
  if (stats.samplesInWindow > 60 && stats.trend !== 'stable') {
    confidence = 'high';
  } else if (stats.samplesInWindow > 20) {
    confidence = 'medium';
  }

  // Estimate minutes until projected breach based on current rate
  let minutesToProjected = null;
  if (willExceed && stats.current < stats.projectedPeak && stats.current > 0) {
    const rate = (stats.projectedPeak - stats.current) / (stats.samplesInWindow || 1);
    if (rate > 0) {
      const ms = ((t - stats.current) / rate) * (30 * 60 * 1000) / stats.samplesInWindow;
      minutesToProjected = Math.max(1, Math.round(ms / 60000));
    }
  }

  return { willExceed, confidence, projectedExcessWatts: Math.round(projectedExcess), minutesToProjected };
}

/**
 * Build a concise prediction summary string for the card UI.
 */
export function formatPredictionSummary(prediction) {
  if (!prediction || !prediction.willExceed) return 'No breach predicted';
  const excess = formatWatts(prediction.projectedExcessWatts);
  const timeStr = prediction.minutesToProjected != null
    ? ` in ~${prediction.minutesToProjected} min`
    : '';
  return `May exceed threshold by ${excess}${timeStr} (${prediction.confidence} confidence)`;
}
