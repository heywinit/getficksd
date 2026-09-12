from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from solve import solve


def base_payload(interval_count: int = 4) -> dict:
    starts_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    ends_at = starts_at + timedelta(minutes=15 * interval_count)
    return {
        "starts_at": starts_at.isoformat(),
        "interval_minutes": 15,
        "interval_count": interval_count,
        "loss_factor": 1.0,
        "assets": [
            {"id": "solar", "type": "solar", "capacity_kw": 10},
            {
                "id": "battery",
                "type": "battery",
                "capacity_kwh": 10,
                "minimum_stored_energy_kwh": 1,
                "max_charge_kw": 4,
                "max_discharge_kw": 4,
                "charge_efficiency": 1,
                "discharge_efficiency": 1,
            },
        ],
        "services": [
            {
                "id": "clinic",
                "control_mode": "fixed",
                "rated_power_kw": 5,
            }
        ],
        "contracts": [
            {
                "id": "clinic-power",
                "service_id": "clinic",
                "kind": "continuous_power",
                "priority": "critical",
                "window_start": starts_at.isoformat(),
                "deadline": ends_at.isoformat(),
                "minimum_power_kw": 2,
            }
        ],
        "renewable_availability_kw": {"solar": [5] * interval_count},
        "service_demand_kw": {"clinic": [2] * interval_count},
        "fuel_delivery_liters": {},
        "initial_energy_kwh": {"battery": 5},
        "initial_fuel_liters": {},
        "initial_running": {},
        "connected_assets": {"solar": True, "battery": True},
        "chargeable_batteries": {"battery": True},
        "connected_services": {"clinic": True},
        "policy_minimum_kwh": {"battery": 1},
        "physical_minimum_kwh": {"battery": 1},
    }


def test_renewable_plan_meets_contract_and_reserve() -> None:
    payload = base_payload()
    result = solve(payload)

    assert result["status"] == "optimal"
    assert set(result) == {
        "status",
        "objective_value",
        "mip_gap",
        "solve_ms",
        "service_requested_kw",
        "service_delivered_kw",
        "renewable_used_kw",
        "battery_charge_kw",
        "battery_discharge_kw",
        "battery_energy_kwh",
        "generator_output_kw",
        "generator_running",
        "generator_started",
        "dumped_power_kw",
    }
    assert min(result["service_delivered_kw"]["clinic"]) >= 2 - 1e-7
    assert min(result["battery_energy_kwh"]["battery"]) >= 1 - 1e-7

    for index in range(payload["interval_count"]):
        supply = (
            result["renewable_used_kw"]["solar"][index]
            + result["battery_discharge_kw"]["battery"][index]
        )
        use = (
            result["service_delivered_kw"]["clinic"][index]
            + result["battery_charge_kw"]["battery"][index]
            + result["dumped_power_kw"][index]
        )
        assert supply == pytest.approx(use, abs=1e-7)


def test_runtime_contract_commits_generator_for_minimum_runtime() -> None:
    payload = base_payload(interval_count=4)
    starts_at = datetime.fromisoformat(payload["starts_at"])
    payload["assets"] = [
        {
            "id": "diesel",
            "type": "diesel",
            "minimum_output_kw": 2,
            "maximum_output_kw": 5,
            "liters_per_kwh": 0.25,
            "startup_fuel_liters": 0.1,
            "minimum_runtime_minutes": 30,
            "ramp_rate_kw_per_minute": 1,
            "fuel_cost_per_liter": 80,
            "emissions_kg_co2_per_liter": 2.6,
        }
    ]
    payload["services"] = [
        {"id": "pump", "control_mode": "shiftable", "rated_power_kw": 2}
    ]
    payload["contracts"] = [
        {
            "id": "pump-runtime",
            "service_id": "pump",
            "kind": "runtime_by_deadline",
            "priority": "essential",
            "window_start": starts_at.isoformat(),
            "deadline": (starts_at + timedelta(hours=1)).isoformat(),
            "required_runtime_minutes": 30,
        }
    ]
    payload["renewable_availability_kw"] = {}
    payload["service_demand_kw"] = {"pump": [2, 2, 2, 2]}
    payload["fuel_delivery_liters"] = {"diesel": [0, 0, 0, 0]}
    payload["initial_energy_kwh"] = {}
    payload["initial_fuel_liters"] = {"diesel": 5}
    payload["initial_running"] = {"diesel": False}
    payload["connected_assets"] = {"diesel": True}
    payload["chargeable_batteries"] = {}
    payload["connected_services"] = {"pump": True}
    payload["policy_minimum_kwh"] = {}
    payload["physical_minimum_kwh"] = {}

    result = solve(payload)

    delivered = result["service_delivered_kw"]["pump"]
    assert sum(power >= 2 - 1e-7 for power in delivered) >= 2
    for index, started in enumerate(result["generator_started"]["diesel"]):
        if started:
            assert all(result["generator_running"]["diesel"][index : index + 2])
