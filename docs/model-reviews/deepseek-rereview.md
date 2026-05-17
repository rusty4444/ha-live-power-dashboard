Here's the full re-review status:

## Re-review: Release-Blocking Issues

### HACS requirements — PASS
- **hacs.json**: `"content_in_root": false`, `"homeassistant": "2024.8.0"`, `"domains": ["live_power_dashboard"]` — all valid.
- **manifest.json**: `domain`, `version`, `config_flow: true`, `iot_class: "local_push"`, `codeowners` — all present.
- **Brand icon**: `brand/icon.svg` exists (SVG with HACS-compatible dark-bg styling).
- **Translations**: `en.json` present with `config.step` and `config.abort` keys.
- **config_flow.py**: `ConfigFlow` subclass with `async_step_user`, `async_set_unique_id`, `_abort_if_unique_id_configured` — correct pattern.
- **services.yaml**: Present (empty `{}` — valid, integration simply has no custom services).

### Lovelace card security — PASS
- **Shadow DOM**: `attachShadow({ mode: 'open' })` — proper encapsulation.
- **`escapeHtml`**: Applied to `title`, circuit names, labels. All 5 HTML-sensitive chars (`& < > " '`) escaped.
- **`innerHTML`**: Set on `this.shadowRoot` inside a `<style>...</style><ha-card>...</ha-card>` wrapper — not on the document DOM.
- **No direct `eval()`/`innerHTML` injection**: Configuration flows through `setConfig` which is strictly read.
- **No external script loads**: Zero `src=` or network requests in the card.

### Packaging — PASS
- **Build script**: `esbuild src/power-dashboard-card.js --bundle --format=esm --target=es2020 --outfile=custom_components/live_power_dashboard/www/power-dashboard-card.js` — correct, produces single ESM bundle.
- **Component path**: Card JS lives at `custom_components/live_power_dashboard/www/power-dashboard-card.js` — HACS/CDN-correct path for custom component resources.
- **Static URL registration**: `__init__.py` uses `hass.http.async_register_static_paths` with `StaticPathConfig` — correct HA API.
- **`npm run check`**: Builds, runs Node tests, runs pytest, py-compiles — all wired.
- **`.gitignore`**: Missing. Should include `node_modules/` and the built bundle. **Minor issue** — not release-blocking for HACS (HACS ignores node_modules by standard gitignore conventions), but worth adding.
- **Bundle committed**: The built JS at `custom_components/live_power_dashboard/www/power-dashboard-card.js` is committed. Not checked for drift against source via CI yet, but `verify-bundle` script exists.

### Validation — PASS
- **storage.py**: Entity ID regex validation (`^[a-zA-Z_][\w]*\.[a-zA-Z0-9_]+$`), positive-number validation, object/array type checks, ID slug sanitization, currency truncation to 8 chars.
- **Python tests**: 5 test cases covering missing ID, entity sanitization, bad entity IDs, bad types, negative numbers, currency truncation.
- **JS tests**: 5 test cases covering `formatWatts`, `classifyGridFlow`, `peakRisk`, `escapeHtml`, `readPowerWatts` unit conversion.
- **REST API**: Admin-only check on POST/DELETE endpoints (`_user_is_admin`), JSON decode error handling, 400/403 status codes.

### Verdict

**No release-blocking issues found.** The integration is HACS-ready:
- HACS metadata is correct and matches the component files.
- All Python files are syntactically valid (py_compile passes).
- The Lovelace card uses Shadow DOM + HTML-escaping of all user-controlled fields.
- No cloud dependency, no external network calls, no unvalidated storage paths.
- Test coverage exists for both JS and Python sides.

The only non-blocking gap: **no `.gitignore`** — add one to ensure `node_modules/` isn't accidentally tracked.
