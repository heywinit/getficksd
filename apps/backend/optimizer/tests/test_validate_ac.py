from __future__ import annotations

from validate_ac import validate


OUTPUT_FIELDS = {
    "status",
    "model_name",
    "source",
    "assumptions",
    "checked_intervals",
    "converged_intervals",
    "checked_buses",
    "checked_lines",
    "components_checked",
    "min_voltage_pu",
    "min_voltage_bus_id",
    "min_voltage_interval",
    "max_voltage_pu",
    "max_line_loading_percent",
    "max_loaded_line_id",
    "max_line_loading_interval",
    "calculated_loss_kwh",
    "validation_ms",
    "violations",
}


def request(delivered_kw: float, network: dict | None = None) -> dict:
    result = {
        "optimizer_input": {
            "interval_count": 2,
            "interval_minutes": 15,
            "services": [
                {
                    "id": "clinic",
                    "control_mode": "fixed",
                    "rated_power_kw": max(20, delivered_kw),
                }
            ],
        },
        "optimizer_solution": {
            "service_delivered_kw": {"clinic": [delivered_kw, delivered_kw]},
        },
    }
    if network is not None:
        result["network"] = network
    return result


def test_default_radial_feeder_passes_and_has_strict_shape() -> None:
    result = validate(request(10))

    assert set(result) == OUTPUT_FIELDS
    assert result["status"] == "pass"
    assert result["source"] == "synthetic_default"
    assert result["checked_intervals"] == 2
    assert result["converged_intervals"] == 2
    assert result["checked_buses"] == 4
    assert result["checked_lines"] == 3
    assert 0.95 <= result["min_voltage_pu"] <= result["max_voltage_pu"] <= 1.05
    assert result["violations"] == []
    assert any("not a measured site network" in item for item in result["assumptions"])


def test_stressed_provided_feeder_reports_line_overload() -> None:
    network = {
        "model_name": "stressed-test-feeder",
        "source": "provided_network",
        "nominal_voltage_kv": 0.415,
        "minimum_voltage_pu": 0.90,
        "maximum_voltage_pu": 1.05,
        "maximum_line_loading_percent": 100,
        "load_power_factor": 0.95,
        "buses": [{"id": "controller"}, {"id": "clinic-bus"}],
        "lines": [
            {
                "id": "undersized-line",
                "from_bus": "controller",
                "to_bus": "clinic-bus",
                "length_km": 0.10,
                "r_ohm_per_km": 0.206,
                "x_ohm_per_km": 0.080,
                "max_i_ka": 0.05,
            }
        ],
        "service_bus_map": {"clinic": "clinic-bus"},
        "assumptions": ["This test uses an intentionally undersized line."],
    }

    result = validate(request(50, network))

    assert set(result) == OUTPUT_FIELDS
    assert result["status"] == "violations"
    assert result["source"] == "provided_network"
    assert result["max_line_loading_percent"] > 100
    assert result["max_loaded_line_id"] == "undersized-line"
    assert any(item["kind"] == "line_overload" for item in result["violations"])
