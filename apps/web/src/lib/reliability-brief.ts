import type { ContractStatus, PlanRun, Scenario } from "@/lib/plan-run";

export type ReliabilityBrief = {
  conclusion: {
    headline: string;
    detail: string;
  };
  commitments: Array<{
    id: string;
    commitment: string;
    promise: string;
    result: "Protected" | "Completed" | "Breached" | "Deferred" | "Available";
    why: string;
    tone: "positive" | "warning" | "neutral";
  }>;
  timeline: Array<{
    id: string;
    timestamp: string;
    time: string;
    label: string;
    kind: "event" | "risk" | "decision" | "outcome";
  }>;
  tradeoffs: Array<{
    label: string;
    value: string;
    detail: string;
  }>;
  resilience: {
    statement: string;
    tests: Array<{
      label: string;
      value: number;
      maximum: number;
      displayValue: string;
    }>;
    battery: {
      minimumEnergyKwh: number;
      reserveEnergyKwh: number;
      capacityKwh: number;
    };
    evidence: string;
    recommendation: string | null;
  };
};

export function deriveReliabilityBrief(
  run: PlanRun,
  scenario: Scenario,
  comparisonRun?: PlanRun,
): ReliabilityBrief {
  const contractLookup = new Map(scenario.contracts.map((contract) => [contract.id, contract]));
  const serviceLookup = new Map(scenario.site.services.map((service) => [service.id, service]));
  const outcomeLookup = new Map(
    run.contract_outcomes.map((outcome) => [outcome.contract_id, outcome]),
  );
  const priorityContracts = scenario.contracts.filter(
    (contract) => contract.priority === "critical" || contract.priority === "essential",
  );
  const priorityMet = priorityContracts.filter(
    (contract) => outcomeLookup.get(contract.id)?.status === "met",
  ).length;
  const breached = priorityContracts.length - priorityMet;
  const runningWindow = getGeneratorWindow(run);
  const deferredEnergyKwh = sumDeferredEnergy(run, scenario);
  const clinicService = scenario.site.services.find(
    (service) => service.id === "clinic-cold-chain",
  );

  const detail =
    runningWindow && deferredEnergyKwh > 0
      ? `Wattson deferred flexible demand and used diesel from ${formatTime(
          runningWindow.start,
          scenario.site.timezone,
        )} to ${formatTime(
          runningWindow.end,
          scenario.site.timezone,
        )} to preserve ${(clinicService?.name ?? "the clinic cold chain").toLowerCase()} overnight.`
      : run.decisions.length > 0
        ? `Wattson made ${pluralize(
            run.decisions.length,
            "recorded intervention",
          )} to keep the operating plan on contract.`
        : "The operating plan met every priority commitment without a recorded intervention.";

  const commitments: ReliabilityBrief["commitments"] = scenario.contracts.map((contract) => {
    const outcome = outcomeLookup.get(contract.id);
    const service = serviceLookup.get(contract.service_id);
    const decision = run.decisions.find((item) => item.affected_contract_ids.includes(contract.id));
    const result = resultForContract(contract.kind, outcome?.status);

    return {
      id: contract.id,
      commitment: service?.name ?? contract.name,
      promise: formatPromise(contract, scenario.site.timezone),
      result,
      why:
        outcome?.status === "breached"
          ? formatBreachReason(outcome.shortfall, contract.kind)
          : (decision?.reason ?? "The planned delivery stayed within its contract window."),
      tone: outcome?.status === "breached" ? ("warning" as const) : ("positive" as const),
    };
  });

  const flexibleServices = scenario.site.services.filter(
    (service) => service.control_mode === "curtailable",
  );
  for (const service of flexibleServices) {
    const serviceDeferredEnergy = sumDeferredEnergy(run, scenario, service.id);
    const decision = run.decisions.find((item) => item.affected_service_ids.includes(service.id));
    commitments.push({
      id: service.id,
      commitment: service.name,
      promise: "Deferrable during a supply constraint",
      result: serviceDeferredEnergy > 0 ? "Deferred" : "Available",
      why:
        serviceDeferredEnergy > 0
          ? (decision?.reason ?? "Released capacity for higher-priority services.")
          : "No curtailment was required.",
      tone: "neutral",
    });
  }

  const timeline = createTimeline(run, scenario, contractLookup, serviceLookup);
  const dieselUsedLiters = run.intervals.reduce(
    (total, interval) =>
      total +
      interval.generators.reduce(
        (intervalTotal, generator) => intervalTotal + generator.fuel_used_liters,
        0,
      ),
    0,
  );
  const extraCost = Math.max(
    0,
    run.summary.total_diesel_cost - (comparisonRun?.summary.total_diesel_cost ?? 0),
  );
  const extraEmissions = Math.max(
    0,
    run.summary.total_emissions_kg_co2 - (comparisonRun?.summary.total_emissions_kg_co2 ?? 0),
  );
  const reserveBuffer = Math.max(
    0,
    run.summary.minimum_battery_energy_kwh - scenario.operating_policy.reserve_energy_kwh,
  );
  const currency = scenario.site.currency;

  const tradeoffs = [
    {
      label: "Extra diesel used",
      value: `${formatNumber(dieselUsedLiters, 1)} L`,
      detail: runningWindow
        ? `Generator ran from ${formatTime(
            runningWindow.start,
            scenario.site.timezone,
          )} to ${formatTime(runningWindow.end, scenario.site.timezone)}.`
        : "The generator did not run.",
    },
    {
      label: "Estimated additional cost",
      value: formatCurrency(extraCost, currency),
      detail: comparisonRun ? "Difference from the normal-day run." : "Recorded diesel cost.",
    },
    {
      label: "Estimated additional emissions",
      value: `${formatNumber(extraEmissions, 1)} kg CO₂e`,
      detail: comparisonRun ? "Difference from the normal-day run." : "Recorded run emissions.",
    },
    {
      label: "Flexible-load energy deferred",
      value: `${formatNumber(deferredEnergyKwh, 0)} kWh`,
      detail: "Demand moved away from the evening supply constraint.",
    },
    {
      label: "Battery reserve preserved",
      value: `${formatNumber(reserveBuffer, 0)} kWh`,
      detail: `${formatNumber(
        run.summary.minimum_battery_energy_kwh,
        0,
      )} kWh minimum against a ${formatNumber(
        scenario.operating_policy.reserve_energy_kwh,
        0,
      )} kWh policy floor.`,
    },
  ];

  const activeEvents = scenario.events.filter((event) => run.active_event_ids.includes(event.id));
  const batteryAsset = scenario.site.assets.find((asset) => asset.type === "battery");
  const solarEvent = activeEvents.find((event) => event.type === "renewable_shortfall");
  const fuelEvent = activeEvents.find((event) => event.type === "fuel_delivery_delay");
  const solarReduction =
    solarEvent?.availability_multiplier === undefined
      ? undefined
      : Math.round((1 - solarEvent.availability_multiplier) * 100);
  const fuelDelayHours =
    fuelEvent?.scheduled_at && fuelEvent.delayed_until
      ? hoursBetween(fuelEvent.scheduled_at, fuelEvent.delayed_until)
      : undefined;
  const tests = [
    ...(solarReduction === undefined
      ? []
      : [
          {
            label: "Solar reduction tested",
            value: solarReduction,
            maximum: 100,
            displayValue: `${solarReduction}%`,
          },
        ]),
    ...(fuelDelayHours === undefined
      ? []
      : [
          {
            label: "Fuel delay tested",
            value: fuelDelayHours,
            maximum: 12,
            displayValue: `${formatNumber(fuelDelayHours, 0)} hours`,
          },
        ]),
  ];
  const resilienceStatement =
    tests.length > 0
      ? `This plan maintained ${priorityMet} of ${priorityContracts.length} priority commitments through ${joinStressEvidence(
          solarReduction,
          fuelDelayHours,
        )}.`
      : "This run contains no active stress event, so it does not establish a resilience limit.";
  const recommendation =
    breached > 0
      ? "Add capacity or reduce the protected load before this stress case runs again."
      : null;

  return {
    conclusion: {
      headline: `${priorityMet} of ${priorityContracts.length} priority commitments were met.`,
      detail,
    },
    commitments,
    timeline,
    tradeoffs,
    resilience: {
      statement: resilienceStatement,
      tests,
      battery: {
        minimumEnergyKwh: run.summary.minimum_battery_energy_kwh,
        reserveEnergyKwh: scenario.operating_policy.reserve_energy_kwh,
        capacityKwh: batteryAsset?.capacity_kwh ?? run.summary.minimum_battery_energy_kwh,
      },
      evidence:
        tests.length > 0
          ? "The markers show stress levels that this completed PlanRun survived. They are not modeled failure thresholds."
          : "A tested stress run is required before Wattson can state a supported operating margin.",
      recommendation,
    },
  };
}

function createTimeline(
  run: PlanRun,
  scenario: Scenario,
  contractLookup: Map<string, Scenario["contracts"][number]>,
  serviceLookup: Map<string, Scenario["site"]["services"][number]>,
) {
  const entries: Array<{
    id: string;
    timestamp: string;
    label: string;
    kind: "event" | "risk" | "decision" | "outcome";
  }> = [];

  for (const event of scenario.events) {
    if (!run.active_event_ids.includes(event.id)) continue;
    const timestamp = event.start ?? event.scheduled_at;
    if (!timestamp) continue;
    entries.push({
      id: event.id,
      timestamp,
      label: describeEvent(event, scenario.site.timezone),
      kind: "event",
    });
  }

  for (const outcome of run.contract_outcomes) {
    const contract = contractLookup.get(outcome.contract_id);
    if (!contract) continue;
    const serviceName = serviceLookup.get(contract.service_id)?.name ?? contract.name;

    if (outcome.first_risk_interval !== undefined) {
      const riskInterval = run.intervals.find(
        (interval) => interval.index === outcome.first_risk_interval,
      );
      if (riskInterval) {
        entries.push({
          id: `${outcome.contract_id}-risk`,
          timestamp: riskInterval.start,
          label: `${serviceName} contract became at risk`,
          kind: "risk",
        });
      }
    }

    entries.push({
      id: `${outcome.contract_id}-outcome`,
      timestamp: contract.deadline,
      label: `${serviceName} contract ${outcome.status === "met" ? "completed" : "breached"}`,
      kind: "outcome",
    });
  }

  for (const decision of run.decisions) {
    const interval = run.intervals.find((item) => item.index === decision.interval_index);
    if (!interval) continue;
    entries.push({
      id: decision.id,
      timestamp: interval.start,
      label: decision.title,
      kind: "decision",
    });
  }

  return entries
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .map((entry) => ({
      ...entry,
      time: formatTime(entry.timestamp, scenario.site.timezone),
    }));
}

function describeEvent(event: Scenario["events"][number], timezone: string) {
  if (event.type === "renewable_shortfall" && event.availability_multiplier !== undefined) {
    return `Solar output fell to ${Math.round(event.availability_multiplier * 100)}% of forecast availability`;
  }

  if (event.type === "fuel_delivery_delay" && event.delayed_until) {
    return `Fuel delivery was delayed until ${formatTime(event.delayed_until, timezone)}`;
  }

  if (event.type === "demand_surge" && event.demand_multiplier !== undefined) {
    return `Demand increased to ${Math.round(event.demand_multiplier * 100)}% of forecast`;
  }

  return event.name;
}

function resultForContract(
  kind: Scenario["contracts"][number]["kind"],
  status?: ContractStatus,
): "Protected" | "Completed" | "Breached" {
  if (status === "breached") return "Breached";
  return kind === "continuous_power" ? "Protected" : "Completed";
}

function formatPromise(contract: Scenario["contracts"][number], timezone: string) {
  if (contract.kind === "continuous_power") {
    return `Continuous power until ${formatTime(contract.deadline, timezone)}`;
  }

  if (contract.kind === "runtime_by_deadline") {
    return `${formatDuration(contract.required_runtime_minutes ?? 0)} before ${formatTime(
      contract.deadline,
      timezone,
    )}`;
  }

  return `${formatNumber(contract.required_energy_kwh ?? 0, 0)} kWh before ${formatTime(
    contract.deadline,
    timezone,
  )}`;
}

function formatBreachReason(shortfall: number, kind: Scenario["contracts"][number]["kind"]) {
  if (kind === "runtime_by_deadline") {
    return `The run finished ${formatDuration(shortfall)} short of the promised runtime.`;
  }

  return `The run finished ${formatNumber(shortfall, 1)} kWh short of the promise.`;
}

function sumDeferredEnergy(run: PlanRun, scenario: Scenario, serviceId?: string) {
  const intervalHours = scenario.horizon.interval_minutes / 60;
  return run.intervals.reduce(
    (total, interval) =>
      total +
      interval.services
        .filter((service) => serviceId === undefined || service.service_id === serviceId)
        .reduce((intervalTotal, service) => intervalTotal + service.deferred_kw * intervalHours, 0),
    0,
  );
}

function getGeneratorWindow(run: PlanRun) {
  const runningIntervals = run.intervals.filter((interval) =>
    interval.generators.some((generator) => generator.running),
  );
  const first = runningIntervals.at(0);
  const last = runningIntervals.at(-1);
  return first && last ? { start: first.start, end: last.end } : null;
}

function formatTime(timestamp: string, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(timestamp));
}

function formatDuration(minutes: number) {
  const hours = minutes / 60;
  return `${formatNumber(hours, Number.isInteger(hours) ? 0 : 1)} ${hours === 1 ? "hour" : "hours"}`;
}

function formatNumber(value: number, maximumFractionDigits: number) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits }).format(value);
}

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function hoursBetween(start: string, end: string) {
  return (Date.parse(end) - Date.parse(start)) / 3_600_000;
}

function joinStressEvidence(solarReduction?: number, fuelDelayHours?: number) {
  const evidence = [
    ...(solarReduction === undefined ? [] : [`a tested ${solarReduction}% solar reduction`]),
    ...(fuelDelayHours === undefined
      ? []
      : [`a tested ${formatNumber(fuelDelayHours, 0)}-hour fuel delay`]),
  ];
  return evidence.join(" and ");
}

function pluralize(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
