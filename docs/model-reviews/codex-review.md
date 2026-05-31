Findings:

- **High - frontend XSS via card config title**: [src/power-dashboard-card.js](src/power-dashboard-card.js:56) injects `cfg.title` directly into `innerHTML`. A title like `<img src=x onerror=...>` runs in the Home Assistant frontend origin. Build DOM nodes or escape all user-controlled strings before interpolation. The bundled copy has the same issue at [custom_components/live_power_dashboard/www/power-dashboard-card.js](custom_components/live_power_dashboard/www/power-dashboard-card.js:74).

- **High - config API allows any authenticated user to mutate integration storage**: [custom_components/live_power_dashboard/__init__.py](custom_components/live_power_dashboard/__init__.py:57) only sets `requires_auth = True`; `POST` and `DELETE` at lines 65 and 76 can overwrite/delete presets for any logged-in HA user. Config mutation should require admin privileges, or enforce an explicit permission check before writes.

- **Medium - bad API payloads become 500s instead of controlled 400s**: [custom_components/live_power_dashboard/__init__.py](custom_components/live_power_dashboard/__init__.py:67) and line 68 do not catch invalid JSON, non-object JSON, or `ValueError` from [storage.py](custom_components/live_power_dashboard/storage.py:38). Nested values like non-object `entities`/`tariff` can also raise during `dict(...)`. Return structured 400 responses and add tests for malformed payloads.

- **Medium - card silently misreports sensors whose unit is not W**: [src/power-dashboard-card.js](src/power-dashboard-card.js:10) reads only `state` and assumes the number is watts. HA power sensors may expose `kW`; `1.5 kW` would render as `2 W`. Either convert based on `attributes.unit_of_measurement` or validate/document that all configured entities must be W.

- **Medium - release can ship stale frontend bundle**: [package.json](package.json:7) builds into the HACS-shipped `custom_components/.../www` file, but CI at [.github/workflows/ci.yml](.github/workflows/ci.yml:19) does not fail if the generated bundle differs from the committed bundle. Add a post-build `git diff --exit-code custom_components/live_power_dashboard/www/power-dashboard-card.js`.

- **Medium - CI does not validate the Home Assistant integration surface**: current tests cover storage normalization and pure JS math only. There is no Home Assistant install, config-flow test, HTTP view test, hassfest validation, HACS validation, or card render/XSS regression test. For a HACS release, add at least hassfest/HACS validation plus HA pytest coverage for setup, config flow, auth/permission checks, and API error paths.

Verification: `npm test` passed. Python pytest could not start in this read-only sandbox because pytest could not create a temporary capture file; I did not modify files.

Reference docs checked: HACS integration requirements (`https://hacs.xyz/docs/publish/integration/`) and Home Assistant custom integration localization/validation guidance (`https://developers.home-assistant.io/docs/internationalization/custom_integration/`).