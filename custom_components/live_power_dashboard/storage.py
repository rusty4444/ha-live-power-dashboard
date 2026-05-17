from __future__ import annotations

import re
from typing import Any

ENTITY_RE = re.compile(r"^[a-zA-Z_][\w]*\.[a-zA-Z0-9_]+$")


def _clean_entity(value: Any) -> str | None:
    if value is None:
        return None
    entity = str(value).strip()
    if not entity:
        return None
    if not ENTITY_RE.match(entity):
        raise ValueError(f"Invalid entity_id: {entity}")
    return entity


def _clean_number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError) as err:
        raise ValueError(f"Invalid numeric value: {value}") from err
    if number < 0:
        raise ValueError("Numeric values must be positive")
    return number


def _object_or_empty(value: Any, field: str) -> dict[str, Any]:
    if value in (None, ""):
        return {}
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    return value


def normalize_dashboard_config(raw: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalise a stored live power dashboard config.

    The structure intentionally mirrors Lovelace card config so users can export
    storage-backed presets into YAML without conversion.
    """
    if not isinstance(raw, dict):
        raise ValueError("Config must be an object")

    dashboard_id = str(raw.get("id", "")).strip()
    if not dashboard_id:
        raise ValueError("id is required")
    if not re.match(r"^[a-zA-Z0-9_-]+$", dashboard_id):
        raise ValueError("id may contain only letters, numbers, underscores and hyphens")

    title = str(raw.get("title") or dashboard_id.replace("_", " ").title()).strip()
    entities: dict[str, str] = {}
    for key, value in _object_or_empty(raw.get("entities"), "entities").items():
        entity = _clean_entity(value)
        if entity:
            entities[str(key)] = entity

    circuits_raw = raw.get("circuits") or []
    if not isinstance(circuits_raw, list):
        raise ValueError("circuits must be a list")
    circuits: list[dict[str, Any]] = []
    for item in circuits_raw:
        if not isinstance(item, dict):
            continue
        entity = _clean_entity(item.get("entity"))
        if not entity:
            continue
        circuit = {
            "name": str(item.get("name") or entity).strip(),
            "entity": entity,
        }
        max_power = _clean_number(item.get("max_power"))
        if max_power is not None:
            circuit["max_power"] = max_power
        circuits.append(circuit)

    tariff_raw = _object_or_empty(raw.get("tariff"), "tariff")
    tariff: dict[str, Any] = {}
    threshold = _clean_number(tariff_raw.get("threshold_w"))
    if threshold is not None:
        tariff["threshold_w"] = threshold
    if tariff_raw.get("currency"):
        tariff["currency"] = str(tariff_raw["currency"]).strip()[:8]
    peak_entity = _clean_entity(tariff_raw.get("peak_entity"))
    if peak_entity:
        tariff["peak_entity"] = peak_entity

    return {
        "id": dashboard_id,
        "title": title,
        "entities": entities,
        "circuits": circuits,
        "tariff": tariff,
    }
