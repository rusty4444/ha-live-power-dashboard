import pytest

from custom_components.live_power_dashboard.storage import normalize_dashboard_config


def test_normalize_dashboard_config_rejects_missing_id():
    with pytest.raises(ValueError, match="id is required"):
        normalize_dashboard_config({"title": "Main"})


def test_normalize_dashboard_config_sanitizes_entities_and_circuits():
    cfg = normalize_dashboard_config({
        "id": "home",
        "title": "Home Power",
        "entities": {
            "grid_power": " sensor.grid_power ",
            "solar_power": "sensor.solar_power",
            "battery_power": "",
        },
        "circuits": [
            {"name": "EV", "entity": " sensor.ev_power ", "max_power": "7400"},
            {"name": "Broken", "entity": ""},
        ],
        "tariff": {"threshold_w": "5000", "currency": "AUD"},
    })

    assert cfg["id"] == "home"
    assert cfg["entities"] == {
        "grid_power": "sensor.grid_power",
        "solar_power": "sensor.solar_power",
    }
    assert cfg["circuits"] == [{"name": "EV", "entity": "sensor.ev_power", "max_power": 7400.0}]
    assert cfg["tariff"] == {"threshold_w": 5000.0, "currency": "AUD"}


def test_normalize_dashboard_config_rejects_bad_entity_id():
    with pytest.raises(ValueError, match="Invalid entity_id"):
        normalize_dashboard_config({"id": "x", "entities": {"grid_power": "not an entity"}})


def test_normalize_dashboard_config_rejects_bad_nested_objects():
    with pytest.raises(ValueError, match="entities must be an object"):
        normalize_dashboard_config({"id": "x", "entities": ["sensor.grid"]})
    with pytest.raises(ValueError, match="circuits must be a list"):
        normalize_dashboard_config({"id": "x", "circuits": "sensor.grid"})
    with pytest.raises(ValueError, match="tariff must be an object"):
        normalize_dashboard_config({"id": "x", "tariff": ["bad"]})


def test_normalize_dashboard_config_truncates_currency_and_rejects_negative_numbers():
    cfg = normalize_dashboard_config({"id": "x", "tariff": {"threshold_w": 1000, "currency": "AUDollars"}})
    assert cfg["tariff"] == {"threshold_w": 1000.0, "currency": "AUDollar"}

    with pytest.raises(ValueError, match="Numeric values must be positive"):
        normalize_dashboard_config({"id": "x", "tariff": {"threshold_w": -1}})
