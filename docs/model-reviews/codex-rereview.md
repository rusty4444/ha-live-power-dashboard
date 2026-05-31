No release-blocking findings found.

Previous blockers appear resolved:
- XSS: title and circuit names now use `escapeHtml` before `innerHTML`; bundled file has the same fix.
- Authz: `POST`/`DELETE` now require admin via `_user_is_admin`.
- Bad payloads: JSON/validation errors now return `400`; nested `entities`/`tariff` are type-checked.
- Unit handling: `readPowerWatts` converts `kW`/`MW` to watts.
- Bundle freshness: CI now runs `npm run verify-bundle`.
- Packaging: `LICENSE` exists; `node_modules/` is ignored.

Remaining non-blocking validation gap: `circuits` is still permissive at [storage.py](custom_components/live_power_dashboard/storage.py:63): non-list inputs like a string are silently iterated and dropped instead of rejected. I would tighten that before broader release, but I would not call it release-blocking for the current surface.

Verification: `npm test` passed. Python pytest could not start in this read-only sandbox because there is no usable temp directory. I did not modify files.