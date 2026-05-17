I now have a complete picture. Here is the review.

---

## Release-Blocking Review: ha-live-power-dashboard

### CRITICAL — Blocking

**C1. `node_modules` tracked in repo root but NOT excluded from HACS** — `HIGH`

`hacs.json` has `"content_in_root": false` which means HACS expects the component to live under `custom_components/`. That's correct. But the repo root has `node_modules/`, `package-lock.json`, `docs/`, `src/`, `test/`, `tests/`, `pytest.ini`, and `hacs.json` — HACS will have to clone the entire repo including `node_modules` (~6 MB, hundreds of files). While `.gitignore` excludes it from git commits, if a user actually `git clone`s the repo directly (manual install path in README), those SDK files ship.

Fix: add an explicit HACS exclude file (`.hacs.json`) or ensure the `.gitignore` prevents shipping. Alternatively, for HACS custom repository installers, consider adding a `"hacs_repo"` archive workflow pattern. **None of these are fatal**, but the current setup wastes bandwidth for manual installers.

**C2. Empty `services.yaml`** — `MEDIUM`

`services.yaml` is an empty object `{}`. The `__init__.py` defines no services. If any automation or script in the future calls a service on this domain, it will fail silently. This isn't a release blocker itself, but it's dead weight that signals an unfinished contract point. Either define services or remove the file.

**C3. No `.hass`-platform deserialization — the component doesn't own any entities** — `MEDIUM`

`PLATFORMS = []` in `__init__.py`. The integration registers a static HTTP endpoint and a config flow, but creates no entities, sensors, or binary sensors. HACS and the HA frontend will show it as a configured integration with zero entities — which is correct for a "card resource + API" integration, but unusual. Users coming from HACS will expect to find something in the entity registry. Document this loudly in the README (which the README does, but the HA UI won't show that).

---

### CRITICAL — Security

**S1. `innerHTML` in shadow root renders user-supplied circuit names** — `MEDIUM`

```js
const name = String(circuit.name || circuit.entity).replace(/[<>]/g, '');
```

The card strips `<>` from circuit names before inserting via `innerHTML`, which prevents the most obvious XSS vector (script tag injection). However, `innerHTML` is inherently dangerous with any bypass vector in the chain. An attacker who controls the YAML/STORE data could still inject other dangerous characters (`&`, `"`, `'`), though in the Lovelace context the config is usually controlled by the admin. Better approaches in order of preference:

1. Use `textContent` instead of `innerHTML` for `name` — the rest of the HTML structure stays declarative.
2. If you need the full template, build elements with `document.createElement()` and `.appendChild()` for user-supplied values.
3. At minimum, use a DOM purify step like `DOMPurify.sanitize()`.

Risk level: low in practice (HA admin controls card config), but the use of `innerHTML` with any user-supplied interpolation is a latent security smell.

**S2. Card title rendered via `innerHTML` without sanitization** — `LOW`

```js
<div class="title">${cfg.title || 'Live Power Dashboard'}</div>
```

Nearly the same as S1. A YAML YOLO-typo of `title: "<script>alert(1)</script>"` would be neutralized by the shadow DOM boundary and `<>` filter on names, but `title` has **no** sanitization. Same remediation applies.

**S3. REST API `POST` endpoint has no request size limit** — `LOW`

```python
payload = await request.json()
```

HA's `aiohttp` backend has implicit size limits, but there is no explicit `max_content_length` on the `HomeAssistantView`. An oversized JSON payload could tie up the event loop on serialization. Not exploitable for data exfiltration, but a potential DoS vector.

---

### CRITICAL — Packaging

**P1. No `__pycache__` / `.pyc` git tracking — already in `.gitignore`** — OK

The `.gitignore` correctly excludes `__pycache__/` and `*.py[cod]`. However, the `__pycache__` directories exist in `custom_components/live_power_dashboard/` and `tests/` — these must not be committed.

**P2. No LICENSE file** — `HIGH`

There is no `LICENSE` file in the repo root. HACS best practices strongly recommend including a license. Without one, the default copyright "all rights reserved" applies, which is legally ambiguous for an open-source HACS custom component. Add a permissive license (Apache 2.0 or MIT) before submitting to HACS default repo.

**P3. `hacs.json` declares `"homeassistant": "2024.8.0"` but `manifest.json` has no `version` — `MEDIUM`**

Wait — `manifest.json` *does* have `"version": "0.1.0"`. The `hacs.json` minimum HA version (`2024.8.0`) is documented but fairly old. No issue here.

**P4. No HACS `"country"` in `hacs.json`** — `LOW`

HACS uses this for regional filtering. Adding `"country": ["AU"]` is optional but recommended for the HACS default repo.

**P5. No `.gitignore` for `brand/`, `docs/` — minor**

The `brand/` directory with `icon.svg` is correct per HACS branding guidelines. No issue.

---

### CRITICAL — Testing

**T1. Tests don't run offline — only 3 tests covering one function** — `MEDIUM`

There are exactly 3 pytest cases, all testing `normalize_dashboard_config`. Nothing tests:
- The config flow (no `pytest_homeassistant_custom_component` fixture or HA-test harness)
- The HTTP view (GET/POST/DELETE)
- The JavaScript bundle (the Node tests cover `power_math.js` only — 3 tests)
- Card rendering
- Error paths in `storage.py` (invalid numbers, empty circuits, bad tariffs)

This is extremely thin for a release. At minimum, add:
- A Python test for `normalize_dashboard_config` with tariff edge cases (`currency` truncation, nested structures)
- A Python test for the HTTP views using HA's `test_framework`
- A JavaScript test for the card's `entityState` and fallback logic for `load = grid + solar + battery`

**T2. CI workflow runs `npm run check` which invokes `python -m pytest tests -q`** — `LOW`

The CI workflow (`actions/setup-python@v5`) installs only `pytest` but the test imports `from custom_components.live_power_dashboard.storage` which may depend on HA modules (`homeassistant.helpers.storage`, `voluptuous`, etc.). The import in `test_storage.py`:
```python
from custom_components.live_power_dashboard.storage import normalize_dashboard_config
```
This `storage.py` module only imports `re`, `typing`, and `__future__` — it does **not** import HA. So the tests will pass in CI. But this is fragile: any future import of HA internals in `storage.py` will silently break CI with no HA runtime available.

**T3. No `pytest_homeassistant_custom_component` fixture** — `MEDIUM`

For HA custom component testing, the standard approach is to use `pytest-homeassistant-custom-component` and write tests that create mock HA instances. Without this, you can't test the config flow or HTTP views at all.

---

### OTHER — Code Quality

**Q1. `_make_config_view()` returns a class defined inside a function** — `LOW`

This is functional but unconventional. Each call to `_make_config_view()` creates a new class object. Since the HTTP endpoint registration is guarded by `http_registered`, the class is only created once per startup, but it's still a code smell for maintainability.

**Q2. `brand/icon.svg` uses absolute hex colors on a dark icon — fine for dark mode, may vanish on light HA themes**

The SVG has `fill="#101827"` (very dark) for the background rectangle. In the default HA light theme, the icon background blends into the card background. Consider making it transparent or using currentColor-aware strokes.

**Q3. No HACS `"hacs"` field in `hacs.json`**

HACS v2+ supports:
```json
{
  "homeassistant": "2024.8.0",
  "domains": ["live_power_dashboard"],
  "render_readme": true,
  "content_in_root": false
}
```
These are all present. No issue here.

---

## Summary

| ID | Severity | Category | Finding |
|---|---|---|---|
| **P2** | **HIGH** | Packaging | No LICENSE file |
| **C1** | MEDIUM | Packaging | `node_modules` ships in repo root for manual install |
| **C2** | MEDIUM | Integration | Empty `services.yaml` — dead config |
| **T1** | MEDIUM | Testing | Only 3 tests covering 1 file — no config flow, HTTP view, or card tests |
| **T3** | MEDIUM | Testing | No `pytest-homeassistant-custom-component` harness |
| **S1** | MEDIUM | Security | `innerHTML` with `<>`-stripped circuit names — bypass risk |
| **S2** | LOW | Security | Card `title` inserted into `innerHTML` unsanitised |
| **S3** | LOW | Security | No explicit `max_content_length` on POST endpoint |
| **P5** | LOW | Packaging | `hacs.json` has no `"country"` field |
| **Q1** | LOW | Code | `_make_config_view()` creates new class each call |
| **Q2** | LOW | Branding | `icon.svg` background dark-on-dark in light themes |

**Release-blocking item**: **Add a LICENSE file** (MIT or Apache 2.0). Without it the component cannot be accepted into the HACS default repository.

**Strongly recommended before HACS default repo submission**: Add `pytest-homeassistant-custom-component` tests for the config flow and HTTP views (T3), and expand JS tests to cover the card's entity resolution and fallback logic (T1).
