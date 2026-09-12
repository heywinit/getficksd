#!/usr/bin/env python3
"""Solve one prepared Wattson dispatch problem from JSON stdin."""

from __future__ import annotations

import json
import math
import sys
import time
from datetime import datetime
from typing import Any

from pyomo.environ import (
    Binary,
    ConcreteModel,
    Constraint,
    ConstraintList,
    NonNegativeReals,
    Objective,
    RangeSet,
    SolverFactory,
    Var,
    minimize,
    value,
)
from pyomo.opt import TerminationCondition


_PRIORITY_PENALTY = {
    "critical": 10_000_000.0,
    "essential": 1_000_000.0,
    "flexible": 100_000.0,
}
_FIXED_SHORTFALL_PENALTY = 50_000.0
_CURTAILABLE_SHORTFALL_PENALTY = 500.0
_RENEWABLE_CURTAILMENT_PENALTY = 0.01
_BATTERY_THROUGHPUT_PENALTY = 0.001
_DUMP_PENALTY = 0.001


def _number(item: dict[str, Any], name: str, default: float = 0.0) -> float:
    raw = item.get(name, default)
    return default if raw is None else float(raw)


def _parse_time(raw: str) -> datetime:
    return datetime.fromisoformat(raw.replace("Z", "+00:00"))


def _eligible_intervals(
    contract: dict[str, Any], starts_at: datetime, interval_minutes: int, count: int
) -> list[int]:
    window_start = _parse_time(contract["window_start"])
    deadline = _parse_time(contract["deadline"])
    result: list[int] = []
    for index in range(count):
        start = starts_at.timestamp() + index * interval_minutes * 60
        end = start + interval_minutes * 60
        if start >= window_start.timestamp() and end <= deadline.timestamp():
            result.append(index)
    return result


def solve(payload: dict[str, Any]) -> dict[str, Any]:
    started_at = time.perf_counter()
    count = int(payload["interval_count"])
    interval_minutes = int(payload["interval_minutes"])
    interval_hours = interval_minutes / 60.0
    loss_factor = float(payload["loss_factor"])
    starts_at = _parse_time(payload["starts_at"])

    assets = {item["id"]: item for item in payload["assets"]}
    services = {item["id"]: item for item in payload["services"]}
    contracts = {item["id"]: item for item in payload.get("contracts", [])}
    renewable_ids = [
        asset_id for asset_id, item in assets.items() if item["type"] in ("solar", "wind")
    ]
    battery_ids = [asset_id for asset_id, item in assets.items() if item["type"] == "battery"]
    generator_ids = [asset_id for asset_id, item in assets.items() if item["type"] == "diesel"]
    service_ids = list(services)
    contract_ids = list(contracts)

    availability = payload["renewable_availability_kw"]
    demand = payload["service_demand_kw"]
    delivery = payload["fuel_delivery_liters"]
    connected_assets = payload["connected_assets"]
    chargeable_batteries = payload["chargeable_batteries"]
    connected_services = payload["connected_services"]
    initial_energy = payload["initial_energy_kwh"]
    initial_fuel = payload["initial_fuel_liters"]
    initial_running = payload["initial_running"]
    policy_minimum = payload["policy_minimum_kwh"]

    eligible = {
        contract_id: _eligible_intervals(contract, starts_at, interval_minutes, count)
        for contract_id, contract in contracts.items()
    }
    service_contract_intervals: dict[str, set[int]] = {service_id: set() for service_id in service_ids}
    for contract_id, contract in contracts.items():
        service_contract_intervals[contract["service_id"]].update(eligible[contract_id])

    model = ConcreteModel()
    model.T = RangeSet(0, count - 1)
    model.renewable_used = Var(renewable_ids, model.T, domain=NonNegativeReals)
    model.battery_charge = Var(battery_ids, model.T, domain=NonNegativeReals)
    model.battery_discharge = Var(battery_ids, model.T, domain=NonNegativeReals)
    model.battery_energy = Var(battery_ids, model.T, domain=NonNegativeReals)
    model.battery_charge_mode = Var(battery_ids, model.T, domain=Binary)
    model.generator_output = Var(generator_ids, model.T, domain=NonNegativeReals)
    model.generator_on = Var(generator_ids, model.T, domain=Binary)
    model.generator_start = Var(generator_ids, model.T, domain=Binary)
    model.service_delivered = Var(service_ids, model.T, domain=NonNegativeReals)
    model.demand_shortfall = Var(service_ids, model.T, domain=NonNegativeReals)
    model.dumped_power = Var(model.T, domain=NonNegativeReals)
    model.contract_shortfall = Var(contract_ids, domain=NonNegativeReals)

    continuous_pairs = [
        (contract_id, index)
        for contract_id, contract in contracts.items()
        if contract["kind"] == "continuous_power"
        for index in eligible[contract_id]
    ]
    model.continuous_shortfall = Var(continuous_pairs, domain=NonNegativeReals)

    runtime_contracts = [
        contract_id
        for contract_id, contract in contracts.items()
        if contract["kind"] == "runtime_by_deadline"
    ]
    runtime_pairs = [(contract_id, index) for contract_id in runtime_contracts for index in eligible[contract_id]]
    model.runtime_on = Var(runtime_pairs, domain=Binary)

    model.constraints = ConstraintList()

    # Renewable and service bounds.
    for renewable_id in renewable_ids:
        connected = bool(connected_assets.get(renewable_id, False))
        for index in range(count):
            upper = float(availability[renewable_id][index]) if connected else 0.0
            model.constraints.add(model.renewable_used[renewable_id, index] <= upper)

    for service_id, service in services.items():
        mode = service["control_mode"]
        rated = float(service["rated_power_kw"])
        connected = bool(connected_services.get(service_id, False))
        for index in range(count):
            requested = float(demand[service_id][index])
            if mode == "shiftable":
                upper = rated if index in service_contract_intervals[service_id] else 0.0
            else:
                upper = rated if index in service_contract_intervals[service_id] else requested
            if not connected:
                upper = 0.0
            model.constraints.add(model.service_delivered[service_id, index] <= upper)
            model.constraints.add(
                model.demand_shortfall[service_id, index]
                >= requested - model.service_delivered[service_id, index]
            )

    # Battery dynamics and mutually exclusive operating modes.
    for battery_id in battery_ids:
        battery = assets[battery_id]
        capacity = _number(battery, "capacity_kwh")
        minimum = float(policy_minimum[battery_id])
        max_charge = _number(battery, "max_charge_kw") if chargeable_batteries.get(battery_id, False) else 0.0
        max_discharge = _number(battery, "max_discharge_kw") if connected_assets.get(battery_id, False) else 0.0
        charge_efficiency = _number(battery, "charge_efficiency")
        discharge_efficiency = _number(battery, "discharge_efficiency")
        for index in range(count):
            model.constraints.add(model.battery_charge[battery_id, index] <= max_charge * model.battery_charge_mode[battery_id, index])
            model.constraints.add(model.battery_discharge[battery_id, index] <= max_discharge * (1 - model.battery_charge_mode[battery_id, index]))
            previous = float(initial_energy[battery_id]) if index == 0 else model.battery_energy[battery_id, index - 1]
            model.constraints.add(
                model.battery_energy[battery_id, index]
                == previous
                + charge_efficiency * model.battery_charge[battery_id, index] * interval_hours
                - model.battery_discharge[battery_id, index] * interval_hours / discharge_efficiency
            )
            model.constraints.add(model.battery_energy[battery_id, index] >= minimum)
            model.constraints.add(model.battery_energy[battery_id, index] <= capacity)
        # The policy reserve remains available at the horizon boundary.
        model.constraints.add(
            model.battery_energy[battery_id, count - 1] >= minimum
        )

    # Generator commitment, ramp, minimum runtime, and cumulative fuel limits.
    for generator_id in generator_ids:
        generator = assets[generator_id]
        connected = bool(connected_assets.get(generator_id, False))
        minimum_output = _number(generator, "minimum_output_kw") if connected else 0.0
        maximum_output = _number(generator, "maximum_output_kw") if connected else 0.0
        ramp_rate = generator.get("ramp_rate_kw_per_minute")
        ramp = float(ramp_rate) * interval_minutes if ramp_rate is not None else None
        initial_on = 1 if initial_running.get(generator_id, False) and connected else 0
        initial_output = minimum_output if initial_on else 0.0
        liters_per_kwh = _number(generator, "liters_per_kwh")
        startup_fuel = _number(generator, "startup_fuel_liters")
        minimum_runtime = max(0, math.ceil(_number(generator, "minimum_runtime_minutes") / interval_minutes))

        for index in range(count):
            if not connected:
                model.constraints.add(model.generator_on[generator_id, index] == 0)
                model.constraints.add(model.generator_start[generator_id, index] == 0)
            model.constraints.add(model.generator_output[generator_id, index] >= minimum_output * model.generator_on[generator_id, index])
            model.constraints.add(model.generator_output[generator_id, index] <= maximum_output * model.generator_on[generator_id, index])
            previous_on = initial_on if index == 0 else model.generator_on[generator_id, index - 1]
            previous_output = initial_output if index == 0 else model.generator_output[generator_id, index - 1]
            model.constraints.add(model.generator_start[generator_id, index] >= model.generator_on[generator_id, index] - previous_on)
            model.constraints.add(model.generator_start[generator_id, index] <= model.generator_on[generator_id, index])
            model.constraints.add(model.generator_start[generator_id, index] <= 1 - previous_on)
            if ramp is not None:
                model.constraints.add(model.generator_output[generator_id, index] - previous_output <= ramp)
                model.constraints.add(previous_output - model.generator_output[generator_id, index] <= ramp)

            available_fuel = float(initial_fuel[generator_id]) + sum(float(delivery[generator_id][k]) for k in range(index + 1))
            fuel_used = sum(
                liters_per_kwh * model.generator_output[generator_id, k] * interval_hours
                + startup_fuel * model.generator_start[generator_id, k]
                for k in range(index + 1)
            )
            model.constraints.add(fuel_used <= available_fuel)

        if minimum_runtime > 0:
            for index in range(count):
                last = min(count, index + minimum_runtime)
                length = last - index
                model.constraints.add(
                    sum(model.generator_on[generator_id, k] for k in range(index, last))
                    >= length * model.generator_start[generator_id, index]
                )

    # Contracts. One nonnegative slack keeps an impossible scenario solvable.
    for contract_id, contract in contracts.items():
        service_id = contract["service_id"]
        kind = contract["kind"]
        indices = eligible[contract_id]
        if kind == "continuous_power":
            minimum_power = _number(contract, "minimum_power_kw")
            for index in indices:
                model.constraints.add(
                    model.service_delivered[service_id, index]
                    + model.continuous_shortfall[contract_id, index]
                    >= minimum_power
                )
        elif kind == "runtime_by_deadline":
            rated = float(services[service_id]["rated_power_kw"])
            needed = math.ceil(_number(contract, "required_runtime_minutes") / interval_minutes)
            for index in indices:
                model.constraints.add(
                    model.service_delivered[service_id, index]
                    >= rated * model.runtime_on[contract_id, index]
                )
            model.constraints.add(
                model.contract_shortfall[contract_id]
                >= (needed - sum(model.runtime_on[contract_id, index] for index in indices))
                * rated
                * interval_hours
            )
        elif kind == "energy_by_deadline":
            required = _number(contract, "required_energy_kwh")
            model.constraints.add(
                sum(model.service_delivered[service_id, index] * interval_hours for index in indices)
                + model.contract_shortfall[contract_id]
                >= required
            )

    # AC-side power balance. Battery charge and dump absorb generator minimum output.
    for index in range(count):
        supply = (
            sum(model.renewable_used[asset_id, index] for asset_id in renewable_ids)
            + sum(model.battery_discharge[asset_id, index] for asset_id in battery_ids)
            + sum(model.generator_output[asset_id, index] for asset_id in generator_ids)
        )
        use = (
            sum(model.service_delivered[service_id, index] for service_id in service_ids) / loss_factor
            + sum(model.battery_charge[asset_id, index] for asset_id in battery_ids)
            + model.dumped_power[index]
        )
        model.constraints.add(supply == use)

    contract_penalty = sum(
        _PRIORITY_PENALTY[contract["priority"]]
        * (
            sum(
                model.continuous_shortfall[contract_id, index] * interval_hours
                for index in eligible[contract_id]
            )
            if contract["kind"] == "continuous_power"
            else model.contract_shortfall[contract_id]
        )
        for contract_id, contract in contracts.items()
    )
    demand_penalty = sum(
        (_FIXED_SHORTFALL_PENALTY if services[service_id]["control_mode"] == "fixed" else _CURTAILABLE_SHORTFALL_PENALTY)
        * model.demand_shortfall[service_id, index]
        * interval_hours
        for service_id in service_ids
        for index in range(count)
        if services[service_id]["control_mode"] != "shiftable"
    )
    fuel_cost = sum(
        (
            _number(assets[generator_id], "liters_per_kwh")
            * model.generator_output[generator_id, index]
            * interval_hours
            + _number(assets[generator_id], "startup_fuel_liters")
            * model.generator_start[generator_id, index]
        )
        * _number(assets[generator_id], "fuel_cost_per_liter")
        for generator_id in generator_ids
        for index in range(count)
    )
    renewable_curtailment = sum(
        (float(availability[renewable_id][index]) - model.renewable_used[renewable_id, index])
        * interval_hours
        * _RENEWABLE_CURTAILMENT_PENALTY
        for renewable_id in renewable_ids
        for index in range(count)
        if connected_assets.get(renewable_id, False)
    )
    battery_throughput = sum(
        (model.battery_charge[battery_id, index] + model.battery_discharge[battery_id, index])
        * interval_hours
        * _BATTERY_THROUGHPUT_PENALTY
        for battery_id in battery_ids
        for index in range(count)
    )
    dump_penalty = sum(model.dumped_power[index] * interval_hours * _DUMP_PENALTY for index in range(count))
    model.objective = Objective(
        expr=contract_penalty + demand_penalty + fuel_cost + renewable_curtailment + battery_throughput + dump_penalty,
        sense=minimize,
    )

    solver = SolverFactory("appsi_highs")
    solver.options["time_limit"] = 7.0
    solver.options["mip_rel_gap"] = 0.001
    result = solver.solve(model)
    termination = result.solver.termination_condition
    if termination not in (TerminationCondition.optimal, TerminationCondition.feasible, TerminationCondition.maxTimeLimit):
        raise RuntimeError(f"HiGHS did not find a usable solution: {termination}")

    def series(variable: Any, item_id: str) -> list[float]:
        return [max(0.0, float(value(variable[item_id, index]))) for index in range(count)]

    delivered_output = {
        service_id: series(model.service_delivered, service_id) for service_id in service_ids
    }
    requested_output: dict[str, list[float]] = {}
    for service_id, service in services.items():
        if service["control_mode"] == "shiftable":
            requested_output[service_id] = list(delivered_output[service_id])
        else:
            requested_output[service_id] = [
                max(float(demand[service_id][index]), delivered_output[service_id][index])
                for index in range(count)
            ]

    on_output = {
        generator_id: [bool(round(float(value(model.generator_on[generator_id, index])))) for index in range(count)]
        for generator_id in generator_ids
    }
    start_output = {
        generator_id: [bool(round(float(value(model.generator_start[generator_id, index])))) for index in range(count)]
        for generator_id in generator_ids
    }
    status = "optimal" if termination == TerminationCondition.optimal else "feasible"
    return {
        "status": status,
        "objective_value": max(0.0, float(value(model.objective))),
        "mip_gap": 0.0 if status == "optimal" else 1.0,
        "solve_ms": max(0, round((time.perf_counter() - started_at) * 1000)),
        "service_requested_kw": requested_output,
        "service_delivered_kw": delivered_output,
        "renewable_used_kw": {
            item_id: series(model.renewable_used, item_id) for item_id in renewable_ids
        },
        "battery_charge_kw": {
            item_id: series(model.battery_charge, item_id) for item_id in battery_ids
        },
        "battery_discharge_kw": {
            item_id: series(model.battery_discharge, item_id) for item_id in battery_ids
        },
        "battery_energy_kwh": {
            item_id: series(model.battery_energy, item_id) for item_id in battery_ids
        },
        "generator_output_kw": {
            item_id: series(model.generator_output, item_id) for item_id in generator_ids
        },
        "generator_running": on_output,
        "generator_started": start_output,
        "dumped_power_kw": [max(0.0, float(value(model.dumped_power[index]))) for index in range(count)],
    }


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        result = solve(payload)
        json.dump(result, sys.stdout, separators=(",", ":"), allow_nan=False)
        sys.stdout.write("\n")
        return 0
    except Exception as error:
        print(f"optimizer error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
