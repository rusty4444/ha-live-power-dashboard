from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .const import CARD_FILENAME, DOMAIN, STATIC_URL, STORAGE_KEY, STORAGE_VERSION
from .storage import normalize_dashboard_config

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry
    from homeassistant.core import HomeAssistant
    from homeassistant.helpers.typing import ConfigType

_LOGGER = logging.getLogger(__name__)
PLATFORMS: list[str] = []


async def async_setup(hass: "HomeAssistant", config: "ConfigType") -> bool:
    await _async_register_http(hass)
    return True


async def async_setup_entry(hass: "HomeAssistant", entry: "ConfigEntry") -> bool:
    await _async_register_http(hass)
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = entry.data
    return True


async def async_unload_entry(hass: "HomeAssistant", entry: "ConfigEntry") -> bool:
    hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    return True


async def _async_register_http(hass: "HomeAssistant") -> None:
    from homeassistant.components.http import StaticPathConfig

    if hass.data.setdefault(DOMAIN, {}).get("http_registered"):
        return

    static_path = Path(__file__).parent / "www"
    await hass.http.async_register_static_paths([
        StaticPathConfig(STATIC_URL, str(static_path), cache_headers=True)
    ])
    hass.http.register_view(_make_config_view())
    hass.data[DOMAIN]["http_registered"] = True
    _LOGGER.info("Registered Live Power Dashboard card at %s/%s", STATIC_URL, CARD_FILENAME)


def _make_config_view():
    from json import JSONDecodeError

    from homeassistant.components.http import KEY_HASS, HomeAssistantView
    from homeassistant.helpers.storage import Store

    def _user_is_admin(request) -> bool:
        user = request.get("hass_user") if hasattr(request, "get") else None
        return bool(getattr(user, "is_admin", False))

    class LivePowerDashboardConfigView(HomeAssistantView):
        url = "/api/live_power_dashboard/config"
        name = "api:live_power_dashboard:config"
        requires_auth = True

        async def get(self, request):
            hass = request.app[KEY_HASS]
            store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
            data = await store.async_load() or {"dashboards": []}
            return self.json(data)

        async def post(self, request):
            if not _user_is_admin(request):
                return self.json({"error": "admin privileges are required"}, status_code=403)
            hass = request.app[KEY_HASS]
            try:
                payload = await request.json()
                dashboard = normalize_dashboard_config(payload)
            except (JSONDecodeError, ValueError, TypeError) as err:
                return self.json({"error": str(err)}, status_code=400)
            store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
            data = await store.async_load() or {"dashboards": []}
            dashboards = [item for item in data.get("dashboards", []) if item.get("id") != dashboard["id"]]
            dashboards.append(dashboard)
            await store.async_save({"dashboards": dashboards})
            return self.json({"saved": dashboard})

        async def delete(self, request):
            if not _user_is_admin(request):
                return self.json({"error": "admin privileges are required"}, status_code=403)
            hass = request.app[KEY_HASS]
            dashboard_id = request.query.get("id", "").strip()
            if not dashboard_id:
                return self.json({"error": "id query parameter is required"}, status_code=400)
            store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
            data = await store.async_load() or {"dashboards": []}
            dashboards = [item for item in data.get("dashboards", []) if item.get("id") != dashboard_id]
            await store.async_save({"dashboards": dashboards})
            return self.json({"deleted": dashboard_id})

    return LivePowerDashboardConfigView
