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

// src/power-dashboard-card.js
var CSS = `
:host{display:block;font-family:var(--primary-font-family,Roboto,Arial,sans-serif)}
.card{background:var(--ha-card-background,var(--card-background-color,#fff));border-radius:var(--ha-card-border-radius,12px);box-shadow:var(--ha-card-box-shadow,0 2px 6px #0002);padding:18px;color:var(--primary-text-color,#111)}
.header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px}.title{font-size:20px;font-weight:700}.subtitle{color:var(--secondary-text-color,#666);font-size:13px;margin-top:3px}.risk{border-radius:999px;padding:5px 10px;font-weight:700;font-size:12px;text-transform:uppercase}.risk.normal{background:#16a34a22;color:#16a34a}.risk.watch{background:#f59e0b22;color:#b45309}.risk.peak{background:#ef444422;color:#dc2626}.risk.unknown{background:#64748b22;color:#64748b}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.metric{border:1px solid var(--divider-color,#ddd);border-radius:12px;padding:12px}.label{color:var(--secondary-text-color,#666);font-size:12px;text-transform:uppercase;letter-spacing:.04em}.value{font-size:24px;font-weight:800;margin-top:6px}.import{color:#dc2626}.export{color:#16a34a}.solar{color:#d97706}.battery{color:#2563eb}.load{color:#7c3aed}.circuits{margin-top:14px;display:grid;gap:9px}.circuit-row{display:grid;grid-template-columns:minmax(90px,1fr) 3fr auto;align-items:center;gap:10px}.bar{height:10px;background:var(--divider-color,#e5e7eb);border-radius:999px;overflow:hidden}.fill{height:100%;background:linear-gradient(90deg,#38bdf8,#6366f1);border-radius:999px}.empty{color:var(--secondary-text-color,#666);font-size:14px;padding:12px;border:1px dashed var(--divider-color,#ddd);border-radius:12px}@media(max-width:520px){.grid{grid-template-columns:1fr}.circuit-row{grid-template-columns:1fr;gap:5px}}
`;
function metric(label, value, cls = "") {
  return `<div class="metric"><div class="label">${escapeHtml(label)}</div><div class="value ${escapeHtml(cls)}">${formatWatts(value)}</div></div>`;
}
var LivePowerDashboardCard = class extends HTMLElement {
  setConfig(config) {
    if (!config) throw new Error("Card configuration is required");
    this.config = config;
    this.attachShadow({ mode: "open" });
  }
  set hass(hass) {
    this._hass = hass;
    this.render();
  }
  getCardSize() {
    return 5;
  }
  render() {
    if (!this.shadowRoot || !this.config || !this._hass) return;
    const cfg = this.config;
    const gridEntity = cfg.grid_power || cfg.entities?.grid_power;
    const solarEntity = cfg.solar_power || cfg.entities?.solar_power;
    const batteryEntity = cfg.battery_power || cfg.entities?.battery_power;
    const loadEntity = cfg.load_power || cfg.entities?.load_power;
    const grid = readPowerWatts(this._hass, gridEntity) ?? 0;
    const solar = readPowerWatts(this._hass, solarEntity) ?? 0;
    const battery = readPowerWatts(this._hass, batteryEntity) ?? 0;
    const load = readPowerWatts(this._hass, loadEntity) ?? Math.max(0, grid + solar + battery);
    const flow = classifyGridFlow(grid);
    const tariff = cfg.tariff || {};
    const risk = peakRisk(load, tariff.threshold_w || cfg.peak_threshold_w);
    const circuits = Array.isArray(cfg.circuits) ? cfg.circuits : [];
    const circuitRows = circuits.map((circuit) => {
      const watts = readPowerWatts(this._hass, circuit.entity) ?? 0;
      const max = toNumber(circuit.max_power || cfg.default_circuit_max_w || load || 1, 1);
      const pct = Math.max(0, Math.min(100, watts / max * 100));
      const name = escapeHtml(circuit.name || circuit.entity || "Circuit");
      return `<div class="circuit-row"><div>${name}</div><div class="bar"><div class="fill" style="width:${pct}%"></div></div><strong>${formatWatts(watts)}</strong></div>`;
    }).join("");
    const title = escapeHtml(cfg.title || "Live Power Dashboard");
    this.shadowRoot.innerHTML = `<style>${CSS}</style><ha-card class="card">
      <div class="header"><div><div class="title">${title}</div><div class="subtitle">Grid ${flow.direction} \xB7 updates with Home Assistant state changes</div></div><div class="risk ${risk.level}">${risk.level}${risk.ratio ? ` ${(risk.ratio * 100).toFixed(0)}%` : ""}</div></div>
      <div class="grid">
        ${metric(`Grid ${flow.direction}`, flow.watts, flow.direction)}
        ${metric("Whole-home load", load, "load")}
        ${metric("Solar production", solar, "solar")}
        ${metric("Battery power", battery, "battery")}
      </div>
      <div class="circuits">${circuitRows || '<div class="empty">Add circuits to compare breakers, sockets, appliances or EV charging loads.</div>'}</div>
    </ha-card>`;
  }
};
customElements.define("live-power-dashboard-card", LivePowerDashboardCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "live-power-dashboard-card",
  name: "Live Power Dashboard Card",
  description: "Real-time grid, solar, battery, load and peak-demand view."
});
