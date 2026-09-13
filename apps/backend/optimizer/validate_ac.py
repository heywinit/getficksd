#!/usr/bin/env python3
"""Validate a Wattson dispatch with interval AC power-flow calculations."""

from __future__ import annotations

import json
import math
import sys
import time
from dataclasses import dataclass
from typing import Any

import pandapower as pp
from pandapower.auxiliary import LoadflowNotConverged


_WRAPPER_FIELDS = {"optimizer_input", "optimizer_solution", "network"}
_NETWORK_FIELDS = {
    "model_name",
    "source",
    "nominal_voltage_kv",
    "minimum_voltage_pu",
    "maximum_voltage_pu",
    "maximum_line_loading_percent",
    "load_power_factor",
    "buses",
    "lines",
    "service_bus_map",
    "assumptions",
}


@dataclass(frozen=True)
class NetworkSpec:
    model_name: str
    source: str
    nominal_voltage_kv: float
    minimum_voltage_pu: float
    maximum_voltage_pu: float
    maximum_line_loading_percent: float
    load_power_factor: float
    buses: list[dict[str, Any]]
    lines: list[dict[str, Any]]
    service_bus_map: dict[str, str]
    assumptions: list[str]


def _finite_number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} must be a number")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"{field} must be finite")
    return number


def _positive_number(value: Any, field: str) -> float:
    number = _finite_number(value, field)
    if number <= 0:
        raise ValueError(f"{field} must be positive")
    return number


def _validate_series(values: Any, field: str, count: int) -> list[float]:
    if not isinstance(values, list) or len(values) != count:
        raise ValueError(f"{field} must contain {count} values")
    result = [_finite_number(item, f"{field}[{index}]") for index, item in enumerate(values)]
    if any(item < 0 for item in result):
        raise ValueError(f"{field} values must be nonnegative")
    return result


def _default_network(services: list[dict[str, Any]]) -> NetworkSpec:
    service_bus_map: dict[str, str] = {}
    for service in services:
        mode = service["control_mode"]
        if mode == "shiftable":
            bus = "productive-feeder"
        elif mode == "curtailable":
            bus = "community-feeder"
        else:
            bus = "essential-feeder"
        service_bus_map[service["id"]] = bus

    return NetworkSpec(
        model_name="wattson-synthetic-radial-lv-v1",
        source="synthetic_default",
        nominal_voltage_kv=0.415,
        minimum_voltage_pu=0.95,
        maximum_voltage_pu=1.05,
        maximum_line_loading_percent=100.0,
        load_power_factor=0.95,
        buses=[
            {"id": "controller"},
            {"id": "essential-feeder"},
            {"id": "community-feeder"},
            {"id": "productive-feeder"},
        ],
        lines=[
            {
                "id": "essential-line",
                "from_bus": "controller",
                "to_bus": "essential-feeder",
                "length_km": 0.15,
                "r_ohm_per_km": 0.320,
                "x_ohm_per_km": 0.080,
                "max_i_ka": 0.40,
            },
            {
                "id": "community-line",
                "from_bus": "controller",
                "to_bus": "community-feeder",
                "length_km": 0.15,
                "r_ohm_per_km": 0.206,
                "x_ohm_per_km": 0.080,
                "max_i_ka": 0.50,
            },
            {
                "id": "productive-line",
                "from_bus": "controller",
                "to_bus": "productive-feeder",
                "length_km": 0.30,
                "r_ohm_per_km": 0.320,
                "x_ohm_per_km": 0.080,
                "max_i_ka": 0.35,
            },
        ],
        service_bus_map=service_bus_map,
        assumptions=[
            "The feeder is a deterministic synthetic model, not a measured site network.",
            "The controller is a 0.415 kV voltage-reference bus at 1.0 pu.",
            "Services use a constant 0.95 lagging power factor.",
            "The three feeder branches group fixed, curtailable, and shiftable services.",
            "The line impedances and current ratings are conservative engineering defaults.",
            "Generation and storage connect at the voltage-reference bus; the model validates service-side feeder limits.",
        ],
    )


def _provided_network(raw: dict[str, Any], service_ids: set[str]) -> NetworkSpec:
    unknown = set(raw) - _NETWORK_FIELDS
    if unknown:
        raise ValueError(f"network contains unknown fields: {', '.join(sorted(unknown))}")

    required = _NETWORK_FIELDS - {"assumptions"}
    missing = required - set(raw)
    if missing:
        raise ValueError(f"network is missing fields: {', '.join(sorted(missing))}")
    if raw["source"] != "provided_network":
        raise ValueError("network.source must be provided_network")
    if not isinstance(raw["model_name"], str) or not raw["model_name"].strip():
        raise ValueError("network.model_name must be a nonempty string")

    nominal_voltage = _positive_number(raw["nominal_voltage_kv"], "network.nominal_voltage_kv")
    minimum_voltage = _positive_number(raw["minimum_voltage_pu"], "network.minimum_voltage_pu")
    maximum_voltage = _positive_number(raw["maximum_voltage_pu"], "network.maximum_voltage_pu")
    maximum_loading = _positive_number(
        raw["maximum_line_loading_percent"], "network.maximum_line_loading_percent"
    )
    power_factor = _positive_number(raw["load_power_factor"], "network.load_power_factor")
    if minimum_voltage >= maximum_voltage:
        raise ValueError("network voltage limits are invalid")
    if power_factor > 1:
        raise ValueError("network.load_power_factor must be at most one")

    buses = raw["buses"]
    lines = raw["lines"]
    mapping = raw["service_bus_map"]
    if not isinstance(buses, list) or not buses:
        raise ValueError("network.buses must be a nonempty array")
    if not isinstance(lines, list):
        raise ValueError("network.lines must be an array")
    if not isinstance(mapping, dict) or set(mapping) != service_ids:
        raise ValueError("network.service_bus_map must contain exactly the service IDs")

    bus_ids: list[str] = []
    for index, bus in enumerate(buses):
        if not isinstance(bus, dict) or set(bus) != {"id"}:
            raise ValueError(f"network.buses[{index}] must contain only id")
        bus_id = bus["id"]
        if not isinstance(bus_id, str) or not bus_id:
            raise ValueError(f"network.buses[{index}].id must be a nonempty string")
        bus_ids.append(bus_id)
    if len(set(bus_ids)) != len(bus_ids):
        raise ValueError("network bus IDs must be unique")
    if "controller" not in bus_ids:
        raise ValueError("network must contain the controller bus")

    line_fields = {
        "id",
        "from_bus",
        "to_bus",
        "length_km",
        "r_ohm_per_km",
        "x_ohm_per_km",
        "max_i_ka",
    }
    line_ids: set[str] = set()
    adjacency = {bus_id: set() for bus_id in bus_ids}
    for index, line in enumerate(lines):
        if not isinstance(line, dict) or set(line) != line_fields:
            raise ValueError(f"network.lines[{index}] has invalid fields")
        line_id = line["id"]
        if not isinstance(line_id, str) or not line_id or line_id in line_ids:
            raise ValueError("network line IDs must be nonempty and unique")
        line_ids.add(line_id)
        source = line["from_bus"]
        target = line["to_bus"]
        if source not in adjacency or target not in adjacency or source == target:
            raise ValueError(f"network line {line_id} has invalid endpoints")
        _positive_number(line["length_km"], f"network line {line_id} length_km")
        _positive_number(line["r_ohm_per_km"], f"network line {line_id} r_ohm_per_km")
        reactance = _finite_number(
            line["x_ohm_per_km"], f"network line {line_id} x_ohm_per_km"
        )
        if reactance < 0:
            raise ValueError(f"network line {line_id} x_ohm_per_km must be nonnegative")
        _positive_number(line["max_i_ka"], f"network line {line_id} max_i_ka")
        adjacency[source].add(target)
        adjacency[target].add(source)
    if len(lines) != len(buses) - 1:
        raise ValueError("network must be radial and contain buses minus one lines")
    reached = {"controller"}
    pending = ["controller"]
    while pending:
        current = pending.pop()
        for neighbor in adjacency[current] - reached:
            reached.add(neighbor)
            pending.append(neighbor)
    if reached != set(bus_ids):
        raise ValueError("network must be connected")
    if not all(isinstance(bus_id, str) for bus_id in mapping.values()):
        raise ValueError("network.service_bus_map values must be strings")
    if any(bus_id not in reached for bus_id in mapping.values()):
        raise ValueError("network.service_bus_map references an unknown bus")

    assumptions = raw.get("assumptions", [])
    if not isinstance(assumptions, list) or not all(isinstance(item, str) for item in assumptions):
        raise ValueError("network.assumptions must be an array of strings")
    return NetworkSpec(
        model_name=raw["model_name"].strip(),
        source="provided_network",
        nominal_voltage_kv=nominal_voltage,
        minimum_voltage_pu=minimum_voltage,
        maximum_voltage_pu=maximum_voltage,
        maximum_line_loading_percent=maximum_loading,
        load_power_factor=power_factor,
        buses=buses,
        lines=lines,
        service_bus_map={str(key): str(value) for key, value in mapping.items()},
        assumptions=list(assumptions),
    )


def _build_pandapower_network(
    spec: NetworkSpec, services: list[dict[str, Any]]
) -> tuple[Any, dict[str, int], dict[str, int]]:
    network = pp.create_empty_network(sn_mva=1.0)
    bus_indices = {
        bus["id"]: pp.create_bus(
            network, vn_kv=spec.nominal_voltage_kv, name=bus["id"], type="b"
        )
        for bus in spec.buses
    }
    pp.create_ext_grid(network, bus=bus_indices["controller"], vm_pu=1.0, name="controller")
    for line in spec.lines:
        pp.create_line_from_parameters(
            network,
            from_bus=bus_indices[line["from_bus"]],
            to_bus=bus_indices[line["to_bus"]],
            length_km=float(line["length_km"]),
            r_ohm_per_km=float(line["r_ohm_per_km"]),
            x_ohm_per_km=float(line["x_ohm_per_km"]),
            c_nf_per_km=0.0,
            max_i_ka=float(line["max_i_ka"]),
            name=line["id"],
        )
    load_indices = {
        service["id"]: pp.create_load(
            network,
            bus=bus_indices[spec.service_bus_map[service["id"]]],
            p_mw=0.0,
            q_mvar=0.0,
            name=service["id"],
        )
        for service in services
    }
    return network, bus_indices, load_indices


def validate(request: dict[str, Any]) -> dict[str, Any]:
    started_at = time.perf_counter()
    if not isinstance(request, dict):
        raise ValueError("input must be a JSON object")
    unknown = set(request) - _WRAPPER_FIELDS
    if unknown:
        raise ValueError(f"input contains unknown fields: {', '.join(sorted(unknown))}")
    if "optimizer_input" not in request or "optimizer_solution" not in request:
        raise ValueError("optimizer_input and optimizer_solution are required")

    optimizer_input = request["optimizer_input"]
    solution = request["optimizer_solution"]
    if not isinstance(optimizer_input, dict) or not isinstance(solution, dict):
        raise ValueError("optimizer_input and optimizer_solution must be objects")
    count = int(optimizer_input["interval_count"])
    interval_minutes = int(optimizer_input["interval_minutes"])
    if count <= 0 or interval_minutes <= 0:
        raise ValueError("the planning horizon must be positive")
    services = optimizer_input["services"]
    if not isinstance(services, list):
        raise ValueError("optimizer_input.services must be an array")
    service_ids = {service["id"] for service in services}
    delivered = solution.get("service_delivered_kw")
    if not isinstance(delivered, dict) or set(delivered) != service_ids:
        raise ValueError("optimizer_solution.service_delivered_kw must contain exactly the service IDs")
    delivered = {
        service_id: _validate_series(
            delivered[service_id], f"service_delivered_kw.{service_id}", count
        )
        for service_id in service_ids
    }

    raw_network = request.get("network")
    if raw_network is None:
        spec = _default_network(services)
    elif isinstance(raw_network, dict):
        spec = _provided_network(raw_network, service_ids)
    else:
        raise ValueError("network must be an object")

    network, bus_indices, load_indices = _build_pandapower_network(spec, services)
    tangent = math.tan(math.acos(spec.load_power_factor))
    interval_hours = interval_minutes / 60.0
    violations: list[dict[str, Any]] = []
    converged = 0
    minimum_voltage = math.inf
    maximum_voltage = -math.inf
    maximum_loading = 0.0
    minimum_voltage_bus = ""
    minimum_voltage_interval = -1
    maximum_loading_line = str(network.line.iloc[0]["name"]) if len(network.line) else ""
    maximum_loading_interval = 0
    losses_kwh = 0.0

    for interval in range(count):
        for service_id, load_index in load_indices.items():
            power_mw = delivered[service_id][interval] / 1000.0
            network.load.at[load_index, "p_mw"] = power_mw
            network.load.at[load_index, "q_mvar"] = power_mw * tangent
        try:
            pp.runpp(
                network,
                algorithm="nr",
                calculate_voltage_angles=False,
                init="flat",
                max_iteration=30,
                tolerance_mva=1e-8,
                numba=False,
            )
        except (LoadflowNotConverged, FloatingPointError, ValueError) as error:
            violations.append(
                {
                    "interval_index": interval,
                    "kind": "non_convergence",
                    "element_id": "network",
                    "value": 0.0,
                    "limit": 1.0,
                    "message": f"The AC power flow did not converge: {error}",
                }
            )
            continue

        converged += 1
        for bus_id, bus_index in bus_indices.items():
            voltage = float(network.res_bus.at[bus_index, "vm_pu"])
            if voltage < minimum_voltage:
                minimum_voltage = voltage
                minimum_voltage_bus = bus_id
                minimum_voltage_interval = interval
            maximum_voltage = max(maximum_voltage, voltage)
            if voltage < spec.minimum_voltage_pu:
                violations.append(
                    {
                        "interval_index": interval,
                        "kind": "undervoltage",
                        "element_id": bus_id,
                        "value": voltage,
                        "limit": spec.minimum_voltage_pu,
                        "message": f"Bus {bus_id} voltage is less than the minimum limit.",
                    }
                )
            if voltage > spec.maximum_voltage_pu:
                violations.append(
                    {
                        "interval_index": interval,
                        "kind": "overvoltage",
                        "element_id": bus_id,
                        "value": voltage,
                        "limit": spec.maximum_voltage_pu,
                        "message": f"Bus {bus_id} voltage is more than the maximum limit.",
                    }
                )
        for line_index, line in network.line.iterrows():
            loading = float(network.res_line.at[line_index, "loading_percent"])
            if loading > maximum_loading:
                maximum_loading = loading
                maximum_loading_line = str(line["name"])
                maximum_loading_interval = interval
            if loading > spec.maximum_line_loading_percent:
                violations.append(
                    {
                        "interval_index": interval,
                        "kind": "line_overload",
                        "element_id": str(line["name"]),
                        "value": loading,
                        "limit": spec.maximum_line_loading_percent,
                        "message": f"Line {line['name']} loading is more than the maximum limit.",
                    }
                )
        losses_kwh += max(0.0, float(network.res_line["pl_mw"].sum())) * 1000.0 * interval_hours

    if converged == 0:
        return {
            "status": "error",
            "model_name": spec.model_name,
            "source": spec.source,
            "assumptions": spec.assumptions,
            "checked_intervals": count,
            "converged_intervals": 0,
            "checked_buses": len(bus_indices),
            "checked_lines": len(network.line),
            "components_checked": len(bus_indices) + len(network.line),
            "min_voltage_pu": 0.0,
            "min_voltage_bus_id": "",
            "min_voltage_interval": 0,
            "max_voltage_pu": 0.0,
            "max_line_loading_percent": 0.0,
            "max_loaded_line_id": maximum_loading_line,
            "max_line_loading_interval": 0,
            "calculated_loss_kwh": 0.0,
            "validation_ms": max(0, round((time.perf_counter() - started_at) * 1000)),
            "violations": violations,
            "error": "The AC power flow did not converge for any interval.",
        }
    status = "pass" if converged == count and not violations else "violations"
    return {
        "status": status,
        "model_name": spec.model_name,
        "source": spec.source,
        "assumptions": spec.assumptions,
        "checked_intervals": count,
        "converged_intervals": converged,
        "checked_buses": len(bus_indices),
        "checked_lines": len(network.line),
        "components_checked": len(bus_indices) + len(network.line),
        "min_voltage_pu": minimum_voltage,
        "max_voltage_pu": maximum_voltage,
        "max_line_loading_percent": maximum_loading,
        "calculated_loss_kwh": losses_kwh,
        "min_voltage_bus_id": minimum_voltage_bus,
        "min_voltage_interval": minimum_voltage_interval,
        "max_loaded_line_id": maximum_loading_line,
        "max_line_loading_interval": maximum_loading_interval,
        "violations": violations,
        "validation_ms": max(0, round((time.perf_counter() - started_at) * 1000)),
    }


def main() -> int:
    try:
        request = json.load(sys.stdin)
        result = validate(request)
        json.dump(result, sys.stdout, separators=(",", ":"), allow_nan=False)
        sys.stdout.write("\n")
        return 0
    except Exception as error:
        print(f"AC validator error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
