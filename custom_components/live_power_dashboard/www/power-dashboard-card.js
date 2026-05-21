// src/power_math.js
function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function formatWatts(value) {
  const watts = toNumber(value);
  if (Math.abs(watts) < 1e3) return `${Math.round(watts)} W`;
  return `${(watts / 1e3).toFixed(2)} kW`;
}
function classifyGridFlow(value) {
  const watts = toNumber(value);
  if (Math.abs(watts) < 1) return { direction: "neutral", watts: 0 };
  return watts > 0 ? { direction: "import", watts: Math.abs(watts) } : { direction: "export", watts: Math.abs(watts) };
}
function peakRisk(loadWatts, thresholdWatts) {
  const threshold = toNumber(thresholdWatts);
  if (threshold <= 0) return { level: "unknown", ratio: 0 };
  const ratio = Number((toNumber(loadWatts) / threshold).toFixed(2));
  if (ratio >= 1) return { level: "peak", ratio };
  if (ratio >= 0.8) return { level: "watch", ratio };
  return { level: "normal", ratio };
}
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function readPowerWatts(hass, entityId) {
  if (!entityId || !hass?.states?.[entityId]) return void 0;
  const state = hass.states[entityId];
  const raw = toNumber(state.state, void 0);
  if (raw === void 0) return void 0;
  const unit = String(state.attributes?.unit_of_measurement || "W").toLowerCase();
  if (unit === "kw") return raw * 1e3;
  if (unit === "mw") return raw * 1e6;
  return raw;
}
function recordRollingSample(entityId, watts, now = Date.now()) {
  const key = `lpd_rolling_${entityId}`;
  try {
    const raw = localStorage.getItem(key);
    const window2 = raw ? JSON.parse(raw) : [];
    window2.push({ t: now, w: Math.round(watts) });
    const cutoff = now - 48 * 60 * 60 * 1e3;
    const pruned = window2.filter((s) => s.t >= cutoff);
    localStorage.setItem(key, JSON.stringify(pruned));
    return pruned;
  } catch {
    const fresh = [{ t: now, w: Math.round(watts) }];
    localStorage.setItem(key, JSON.stringify(fresh));
    return fresh;
  }
}
function rollingWindowStats(samples, windowMs = 30 * 60 * 1e3) {
  if (!samples || samples.length === 0) {
    return {
      average: 0,
      peak: 0,
      current: 0,
      trend: "stable",
      projectedPeak: 0,
      samplesInWindow: 0
    };
  }
  const now = samples[samples.length - 1].t;
  const inWindow = samples.filter((s) => s.t >= now - windowMs);
  if (inWindow.length === 0) {
    return {
      average: 0,
      peak: 0,
      current: 0,
      trend: "stable",
      projectedPeak: 0,
      samplesInWindow: 0
    };
  }
  const values = inWindow.map((s) => s.w);
  const current = values[values.length - 1];
  const sum = values.reduce((a, b) => a + b, 0);
  const average = sum / values.length;
  const peak = Math.max(...values);
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
  const trend = slope > 0.5 ? "rising" : slope < -0.5 ? "falling" : "stable";
  const stepInterval = Math.max(1e3, now - (inWindow.length > 1 ? inWindow[inWindow.length - 2].t : 6e4));
  const remainingSteps = Math.max(0, windowMs / stepInterval - n);
  const projectedPeak = Math.max(current, current + slope * remainingSteps);
  return {
    average: Math.round(average),
    peak,
    current,
    trend,
    projectedPeak: Math.max(0, Math.round(projectedPeak)),
    samplesInWindow: inWindow.length
  };
}
function predictDemandRisk(stats, thresholdWatts) {
  const t = toNumber(thresholdWatts, 0);
  if (t <= 0 || stats.samplesInWindow < 5) {
    return { willExceed: false, confidence: "low", projectedExcessWatts: 0, minutesToProjected: null };
  }
  const projectedExcess = Math.max(0, stats.projectedPeak - t);
  const willExceed = projectedExcess > 0;
  let confidence = "low";
  if (stats.samplesInWindow > 60 && stats.trend !== "stable") {
    confidence = "high";
  } else if (stats.samplesInWindow > 20) {
    confidence = "medium";
  }
  let minutesToProjected = null;
  if (willExceed && stats.current < stats.projectedPeak && stats.current > 0) {
    const rate = (stats.projectedPeak - stats.current) / (stats.samplesInWindow || 1);
    if (rate > 0) {
      const ms = (t - stats.current) / rate * (30 * 60 * 1e3) / stats.samplesInWindow;
      minutesToProjected = Math.max(1, Math.round(ms / 6e4));
    }
  }
  return { willExceed, confidence, projectedExcessWatts: Math.round(projectedExcess), minutesToProjected };
}

// src/power-dashboard-card.js
var CSS = `
:host{display:block;font-family:var(--primary-font-family,Roboto,Arial,sans-serif)}
.card{background:var(--ha-card-background,var(--card-background-color,#fff));border-radius:var(--ha-card-border-radius,12px);box-shadow:var(--ha-card-box-shadow,0 2px 6px #0002);padding:18px;color:var(--primary-text-color,#111)}
.header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px}.title{font-size:20px;font-weight:700}.subtitle{color:var(--secondary-text-color,#666);font-size:13px;margin-top:3px}
.risk{border-radius:999px;padding:5px 10px;font-weight:700;font-size:12px;text-transform:uppercase}.risk.normal{background:#16a34a22;color:#16a34a}.risk.watch{background:#f59e0b22;color:#b45309}.risk.peak{background:#ef444422;color:#dc2626}.risk.unknown{background:#64748b22;color:#64748b}
.prediction{margin-top:10px;padding:10px;border-radius:8px;font-size:13px}.prediction.high{background:#ef444422;border:1px solid #ef444444}.prediction.medium{background:#f59e0b22;border:1px solid #f59e0b44}.prediction.low{background:#64748b22;border:1px solid #64748b44}.prediction.none{background:#16a34a22;border:1px solid #16a34a44}
.prediction .pred-title{font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}.prediction .pred-body{display:flex;gap:12px;flex-wrap:wrap}.prediction .pred-stat{font-size:12px}.prediction .pred-stat strong{font-weight:700}
.picker-bar{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}.picker-bar select{flex:1;min-width:160px;padding:6px 8px;border-radius:8px;border:1px solid var(--divider-color,#ddd);background:var(--input-background-color,#fff);color:var(--primary-text-color,#111);font-size:13px}.picker-bar button{padding:6px 14px;border-radius:8px;border:1px solid var(--divider-color,#ddd);background:var(--ha-card-background,#fff);color:var(--primary-text-color,#111);cursor:pointer;font-size:13px;font-weight:600}.picker-bar button:hover{background:var(--divider-color,#eee)}
.editor-panel{background:var(--ha-card-background,var(--card-background-color,#fff));border:2px solid var(--primary-color,#03a9f4);border-radius:var(--ha-card-border-radius,12px);padding:18px;margin-bottom:14px}.editor-panel h3{font-size:16px;margin:0 0 12px 0;color:var(--primary-text-color,#111)}.editor-panel label{display:block;margin-bottom:16px;font-size:13px;color:var(--secondary-text-color,#666)}.editor-panel input,.editor-panel select{display:block;width:100%;margin-top:4px;padding:8px;border:1px solid var(--divider-color,#ddd);border-radius:6px;background:var(--input-background-color,#fff);color:var(--primary-text-color,#111);font-size:14px;box-sizing:border-box}.editor-panel .editor-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.editor-panel .editor-actions{display:flex;gap:8px;margin-top:16px;justify-content:flex-end}.editor-panel .editor-actions button{padding:8px 16px;border-radius:6px;border:none;cursor:pointer;font-weight:600;font-size:13px}.editor-panel .btn-primary{background:var(--primary-color,#03a9f4);color:#fff}.editor-panel .btn-secondary{background:var(--divider-color,#ddd);color:var(--primary-text-color,#111)}.editor-panel .btn-danger{background:#ef4444;color:#fff}
.editor-panel .circuit-entry{border:1px solid var(--divider-color,#ddd);border-radius:8px;padding:12px;margin-bottom:10px}.editor-panel .circuit-entry .circuit-fields{display:grid;grid-template-columns:2fr 3fr 2fr;gap:8px;align-items:end}.editor-panel .circuit-entry .circuit-remove{text-align:right;margin-top:6px}.editor-panel .circuit-entry .circuit-remove button{background:none;border:none;color:#ef4444;cursor:pointer;font-size:12px;font-weight:600;padding:0}.editor-section-title{font-size:14px;font-weight:600;margin:16px 0 8px 0;color:var(--primary-text-color,#111);border-bottom:1px solid var(--divider-color,#ddd);padding-bottom:4px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.metric{border:1px solid var(--divider-color,#ddd);border-radius:12px;padding:12px}.label{color:var(--secondary-text-color,#666);font-size:12px;text-transform:uppercase;letter-spacing:.04em}.value{font-size:24px;font-weight:800;margin-top:6px}.import{color:#dc2626}.export{color:#16a34a}.solar{color:#d97706}.battery{color:#2563eb}.load{color:#7c3aed}.peak-badge{display:inline-block;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;margin-left:6px;vertical-align:middle}.peak-badge.yes{background:#ef444422;color:#dc2626}.peak-badge.no{background:#16a34a22;color:#16a34a}
.circuits{margin-top:14px;display:grid;gap:9px}.circuit-row{display:grid;grid-template-columns:minmax(90px,1fr) 3fr auto;align-items:center;gap:10px}.bar{height:10px;background:var(--divider-color,#e5e7eb);border-radius:999px;overflow:hidden}.fill{height:100%;background:linear-gradient(90deg,#38bdf8,#6366f1);border-radius:999px}.empty{color:var(--secondary-text-color,#666);font-size:14px;padding:12px;border:1px dashed var(--divider-color,#ddd);border-radius:12px}.edit-btn{position:absolute;top:12px;right:12px;background:var(--primary-color,#03a9f4);color:#fff;border:none;border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer;opacity:0.8}.edit-btn:hover{opacity:1}.card-wrap{position:relative}
@media(max-width:520px){.grid{grid-template-columns:1fr}.circuit-row{grid-template-columns:1fr;gap:5px}.editor-panel .editor-row{grid-template-columns:1fr}.editor-panel .circuit-entry .circuit-fields{grid-template-columns:1fr}}
`;
function metric(label, value, cls = "") {
  return `<div class="metric"><div class="label">${escapeHtml(label)}</div><div class="value ${escapeHtml(cls)}">${formatWatts(value)}</div></div>`;
}
function renderEditor(config, hass) {
  const entities = config.entities || {};
  const tariff = config.tariff || {};
  const circuits = Array.isArray(config.circuits) ? config.circuits : [];
  let circuitsHtml = circuits.map((c, i) => `
    <div class="circuit-entry">
      <div class="circuit-fields">
        <input value="${escapeHtml(c.name || "")}" placeholder="Name" data-circuit-field="name" data-idx="${i}">
        <input value="${escapeHtml(c.entity || "")}" placeholder="Entity ID" data-circuit-field="entity" data-idx="${i}">
        <input value="${c.max_power || ""}" placeholder="Max W" type="number" data-circuit-field="max_power" data-idx="${i}">
      </div>
      <div class="circuit-remove"><button data-remove-circuit="${i}">Remove</button></div>
    </div>`).join("");
  const sensorOptions = hass && hass.states ? Object.keys(hass.states).filter((eid) => {
    const state = hass.states[eid];
    const unit = String(state?.attributes?.unit_of_measurement || "").toLowerCase();
    return unit === "w" || unit === "kw" || unit === "mw";
  }).map((eid) => `<option value="${escapeHtml(eid)}"${entities && Object.values(entities).includes(eid) ? " selected" : ""}>${escapeHtml(eid)}</option>`).join("") : '<option value="">No power sensors found</option>';
  const sel = (id) => entities && entities[id] ? entities[id] : "";
  return `
  <div class="editor-panel">
    <h3>Edit Live Power Dashboard</h3>
    <label>Title <input id="editor-title" value="${escapeHtml(config.title || "Live Power Dashboard")}"></label>
    <div class="editor-section-title">Energy Entities</div>
    <div class="editor-row">
      <label>Grid<select id="editor-grid"><option value="">\u2014</option>${sensorOptions}</select></label>
      <label>Solar<select id="editor-solar"><option value="">\u2014</option>${sensorOptions}</select></label>
      <label>Battery<select id="editor-battery"><option value="">\u2014</option>${sensorOptions}</select></label>
      <label>Load<select id="editor-load"><option value="">\u2014</option>${sensorOptions}</select></label>
    </div>
    <div class="editor-section-title">Demand Tariff</div>
    <div class="editor-row">
      <label>Threshold (W) <input id="editor-threshold" type="number" value="${tariff.threshold_w || ""}" placeholder="e.g. 5000"></label>
      <label>Currency <input id="editor-currency" value="${escapeHtml(tariff.currency || "")}" placeholder="AUD" maxlength="8"></label>
    </div>
    <div class="editor-section-title">Circuit Display</div>
    <div class="editor-row">
      <label>Global max (W) <input id="editor-global-max" type="number" value="${config.global_max_w || ""}" placeholder="e.g. 10000 (0 = per-circuit)"></label>
      <label></label>
    </div>
    <div class="editor-section-title">Circuits <button class="btn-secondary" id="editor-add-circuit" style="font-size:12px;padding:2px 8px;margin-left:8px">+ Add</button></div>
    <div id="editor-circuits">${circuitsHtml}</div>
    <div class="editor-actions">
      <button class="btn-secondary" id="editor-cancel">Cancel</button>
      <button class="btn-primary" id="editor-save">Save Config</button>
    </div>
  </div>`;
}
function predictionPanel(prediction, stats, threshold) {
  if (!threshold || threshold <= 0) return "";
  if (!stats || stats.samplesInWindow < 2) {
    return `<div class="prediction low"><div class="pred-title">Demand Prediction</div><div class="pred-body">Collecting data&hellip; (${stats ? stats.samplesInWindow : 0} samples)</div></div>`;
  }
  const conf = prediction && prediction.willExceed ? prediction.confidence : "none";
  const confLabel = conf === "none" ? "Normal" : conf.charAt(0).toUpperCase() + conf.slice(1);
  let html = `<div class="pred-stat"><strong>${stats.samplesInWindow}</strong> samples in 30m window</div>`;
  html += `<div class="pred-stat">Avg <strong>${formatWatts(stats.average)}</strong> &middot; Peak <strong>${formatWatts(stats.peak)}</strong></div>`;
  html += `<div class="pred-stat">Trend <strong>${stats.trend}</strong></div>`;
  if (prediction && prediction.willExceed) {
    html += `<div class="pred-stat" style="color:#dc2626">Predicted breach: <strong>+${formatWatts(prediction.projectedExcessWatts)}${prediction.minutesToProjected != null ? " in ~" + prediction.minutesToProjected + " min" : ""}</strong></div>`;
  } else {
    html += `<div class="pred-stat" style="color:#16a34a">No breach predicted</div>`;
  }
  return `<div class="prediction ${conf}"><div class="pred-title">Demand Prediction &middot; ${confLabel} Risk</div><div class="pred-body">${html}</div></div>`;
}
function presetPickerBar(presets, currentId) {
  if (!presets || presets.length === 0) return "";
  const opts = presets.map((p) => `<option value="${escapeHtml(p.id)}"${p.id === currentId ? " selected" : ""}>${escapeHtml(p.title || p.id)}</option>`).join("");
  return `<div class="picker-bar">
    <select id="preset-select">${opts}</select>
    <button id="preset-save">Save As&hellip;</button>
    <button id="preset-refresh">Reload</button>
  </div>`;
}
var LivePowerDashboardCard = class extends HTMLElement {
  constructor() {
    super();
    this._inEditor = false;
    this._presets = [];
    this._currentPresetId = null;
    this._presetsFetched = false;
    this._rollingData = [];
  }
  setConfig(config) {
    if (!config) throw new Error("Card configuration is required");
    this.config = Object.assign({}, config);
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._applyConfigDefaults();
  }
  set hass(hass) {
    this._hass = hass;
    if (this._inEditor) {
      this.render();
      return;
    }
    this._recordRollingData();
    this.render();
  }
  _applyConfigDefaults() {
    const cfg = this.config;
    cfg.entities = cfg.entities || {};
    if (cfg.grid_power) cfg.entities.grid_power = cfg.grid_power;
    if (cfg.solar_power) cfg.entities.solar_power = cfg.solar_power;
    if (cfg.battery_power) cfg.entities.battery_power = cfg.battery_power;
    if (cfg.load_power) cfg.entities.load_power = cfg.load_power;
  }
  _entityConfig(key) {
    const cfg = this.config;
    const entities = cfg.entities || {};
    return entities[key] || cfg[key];
  }
  _recordRollingData() {
    if (!this._hass || !this.config) return;
    const loadEntity = this._entityConfig("load_power");
    if (!loadEntity) return;
    const load = readPowerWatts(this._hass, loadEntity);
    if (load == null) return;
    this._rollingData = recordRollingSample("load", load);
  }
  getCardSize() {
    return 6;
  }
  async _fetchPresets() {
    try {
      const resp = await fetch("/api/live_power_dashboard/config");
      if (!resp.ok) return;
      const data = await resp.json();
      this._presets = (data.dashboards || []).filter((p) => p.id);
    } catch {
      this._presets = [];
    }
  }
  async _loadPreset(presetId) {
    const preset = this._presets.find((p) => p.id === presetId);
    if (!preset) return;
    this._currentPresetId = preset.id;
    this.config.title = preset.title || preset.id;
    this.config.entities = Object.assign({}, preset.entities || {});
    this.config.circuits = (preset.circuits || []).map((c) => Object.assign({}, c));
    this.config.tariff = Object.assign({}, preset.tariff || {});
    this.config.peak_threshold_w = preset.tariff?.threshold_w;
    this.config.global_max_w = preset.global_max_w || void 0;
    this.render();
  }
  async _saveAsPreset() {
    const cfg = this.config;
    const id = prompt("Preset ID (alphanumeric, hyphens, underscores):");
    if (!id) return;
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      alert("Invalid ID");
      return;
    }
    const payload = {
      id,
      title: cfg.title || "Live Power Dashboard",
      entities: Object.assign({}, cfg.entities || {}),
      circuits: (cfg.circuits || []).map((c) => ({ name: c.name, entity: c.entity, max_power: c.max_power })),
      tariff: { threshold_w: cfg.tariff?.threshold_w || cfg.peak_threshold_w || null, currency: cfg.tariff?.currency || null },
      global_max_w: cfg.global_max_w || null
    };
    try {
      const resp = await fetch("/api/live_power_dashboard/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        alert("Failed to save preset");
        return;
      }
      await this._fetchPresets();
      this._currentPresetId = id;
      this.render();
    } catch {
      alert("Failed to save preset");
    }
  }
  render() {
    if (!this.shadowRoot || !this.config || !this._hass) return;
    if (!this._presetsFetched) {
      this._presetsFetched = true;
      this._fetchPresets();
    }
    const cfg = this.config;
    const entities = cfg.entities || {};
    const grid = readPowerWatts(this._hass, entities.grid_power || cfg.grid_power) ?? 0;
    const solar = readPowerWatts(this._hass, entities.solar_power || cfg.solar_power) ?? 0;
    const battery = readPowerWatts(this._hass, entities.battery_power || cfg.battery_power) ?? 0;
    const load = readPowerWatts(this._hass, entities.load_power || cfg.load_power) ?? Math.max(0, grid + solar + battery);
    const flow = classifyGridFlow(grid);
    const tariff = cfg.tariff || {};
    const threshold = tariff.threshold_w || cfg.peak_threshold_w || 0;
    const risk = peakRisk(load, threshold);
    const stats = rollingWindowStats(this._rollingData);
    const prediction = predictDemandRisk(stats, threshold);
    const circuits = Array.isArray(cfg.circuits) ? cfg.circuits : [];
    const globalMax = toNumber(cfg.global_max_w, 0);
    const annotated = circuits.map((c) => ({
      ...c,
      _watts: readPowerWatts(this._hass, c.entity) ?? 0
    }));
    annotated.sort((a, b) => b._watts - a._watts);
    const circuitRows = annotated.map((c) => {
      const w = c._watts;
      const max = globalMax > 0 ? globalMax : toNumber(c.max_power || cfg.default_circuit_max_w || load || 1, 1);
      const pct = Math.max(0, Math.min(100, w / max * 100));
      return `<div class="circuit-row"><div>${escapeHtml(c.name || c.entity || "Circuit")}</div><div class="bar"><div class="fill" style="width:${pct}%"></div></div><strong>${formatWatts(w)}</strong></div>`;
    }).join("");
    const title = escapeHtml(cfg.title || "Live Power Dashboard");
    this.shadowRoot.innerHTML = `<style>${CSS}</style><ha-card class="card card-wrap">
      <div class="header"><div><div class="title">${title}</div><div class="subtitle">Grid ${flow.direction} &middot; updates with HA state changes</div></div>
        <div><div class="risk ${risk.level}">${risk.level}${risk.level !== "unknown" ? " " + (risk.ratio * 100).toFixed(0) + "%" : ""}</div>
        <button class="edit-btn" id="edit-btn" title="Edit card configuration">Edit</button></div></div>
      ${presetPickerBar(this._presets, this._currentPresetId)}
      ${this._inEditor ? renderEditor(cfg, this._hass) : ""}
      <div class="grid">${metric("Grid " + flow.direction, flow.watts, flow.direction)}${metric("Whole-home load", load, "load")}${metric("Solar production", solar, "solar")}${metric("Battery power", battery, "battery")}</div>
      ${predictionPanel(prediction, stats, threshold)}
      <div class="circuits">${circuitRows || '<div class="empty">Add circuits to compare breakers, sockets, appliances or EV charging loads.</div>'}</div>
    </ha-card>`;
    this._attachEventListeners();
  }
  _attachEventListeners() {
    const root = this.shadowRoot;
    if (!root) return;
    const byId = (id) => root.getElementById(id);
    byId("edit-btn")?.addEventListener("click", () => {
      this._inEditor = !this._inEditor;
      this.render();
    });
    byId("editor-cancel")?.addEventListener("click", () => {
      this._inEditor = false;
      this.render();
    });
    byId("editor-save")?.addEventListener("click", () => this._saveEditor());
    byId("editor-add-circuit")?.addEventListener("click", () => {
      var _a;
      ((_a = this.config).circuits || (_a.circuits = [])).push({ name: "", entity: "", max_power: "" });
      this.render();
    });
    root.querySelectorAll("[data-remove-circuit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-remove-circuit"));
        if (!isNaN(idx)) {
          this.config.circuits?.splice(idx, 1);
          this.render();
        }
      });
    });
    const ps = byId("preset-select");
    ps?.addEventListener("change", () => this._loadPreset(ps.value));
    byId("preset-save")?.addEventListener("click", () => this._saveAsPreset());
    byId("preset-refresh")?.addEventListener("click", async () => {
      await this._fetchPresets();
      this.render();
    });
  }
  _saveEditor() {
    const root = this.shadowRoot;
    if (!root) return;
    const val = (id) => root.getElementById(id)?.value || "";
    const title = val("editor-title") || "Live Power Dashboard";
    const entities = {};
    ["grid", "solar", "battery", "load"].forEach((k) => {
      const v = val("editor-" + k);
      if (v) entities[k + "_power"] = v;
    });
    const threshold = parseFloat(val("editor-threshold")) || 0;
    const currency = val("editor-currency");
    const circuits = [];
    root.querySelectorAll('[data-circuit-field="name"]').forEach((f, i) => {
      const entity = root.querySelector(`[data-circuit-field="entity"][data-idx="${i}"]`)?.value || "";
      if (entity) {
        const mp = root.querySelector(`[data-circuit-field="max_power"][data-idx="${i}"]`)?.value;
        circuits.push({ name: f.value || entity, entity, max_power: mp ? parseFloat(mp) : void 0 });
      }
    });
    this.config.title = title;
    this.config.entities = entities;
    this.config.circuits = circuits;
    this.config.tariff = { threshold_w: threshold || void 0, currency: currency || void 0 };
    if (threshold > 0) this.config.peak_threshold_w = threshold;
    const globalMax = parseFloat(val("editor-global-max")) || 0;
    if (globalMax > 0) this.config.global_max_w = globalMax;
    else delete this.config.global_max_w;
    this._inEditor = false;
    this.render();
  }
};
customElements.define("live-power-dashboard-card", LivePowerDashboardCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "live-power-dashboard-card",
  name: "Live Power Dashboard Card",
  description: "Real-time grid, solar, battery, load and peak-demand view with visual editor, preset picker, and demand prediction."
});
var LivePowerDashboardEditor = class extends HTMLElement {
  setConfig(config) {
    this._config = Object.assign({}, config);
    this._config.entities = this._config.entities || {};
    this.render();
  }
  set hass(hass) {
    this._hass = hass;
    this.render();
  }
  get value() {
    return this._config;
  }
  render() {
    if (!this._config) return;
    if (!this._hass) {
      this.innerHTML = "<div>Loading entities...</div>";
      return;
    }
    this.innerHTML = renderEditor(this._config, this._hass);
    this.querySelector("#editor-save")?.addEventListener("click", () => this._dispatch());
    this.querySelector("#editor-cancel")?.addEventListener("click", () => this._dispatch());
    this.querySelector("#editor-add-circuit")?.addEventListener("click", () => {
      var _a;
      ((_a = this._config).circuits || (_a.circuits = [])).push({ name: "", entity: "", max_power: "" });
      this.render();
    });
    this.querySelectorAll("[data-remove-circuit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-remove-circuit"));
        if (!isNaN(idx)) {
          this._config.circuits?.splice(idx, 1);
          this.render();
        }
      });
    });
  }
  _dispatch() {
    const val = (id) => this.querySelector("#" + id)?.value || "";
    const title = val("editor-title") || "Live Power Dashboard";
    const entities = {};
    ["grid", "solar", "battery", "load"].forEach((k) => {
      const v = val("editor-" + k);
      if (v) entities[k + "_power"] = v;
    });
    const threshold = parseFloat(val("editor-threshold")) || void 0;
    const circuits = [];
    this.querySelectorAll('[data-circuit-field="name"]').forEach((f, i) => {
      const entity = this.querySelector(`[data-circuit-field="entity"][data-idx="${i}"]`)?.value || "";
      if (entity) {
        const mp = this.querySelector(`[data-circuit-field="max_power"][data-idx="${i}"]`)?.value;
        circuits.push({ name: f.value || entity, entity, max_power: mp ? parseFloat(mp) : void 0 });
      }
    });
    const globalMax = parseFloat(val("editor-global-max")) || 0;
    this._config = {
      type: "custom:live-power-dashboard-card",
      title,
      entities: Object.keys(entities).length ? entities : void 0,
      circuits: circuits.length ? circuits : void 0,
      peak_threshold_w: threshold,
      global_max_w: globalMax > 0 ? globalMax : void 0,
      tariff: threshold ? { threshold_w: threshold, currency: val("editor-currency") || void 0 } : void 0
    };
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
  }
};
customElements.define("live-power-dashboard-editor", LivePowerDashboardEditor);
