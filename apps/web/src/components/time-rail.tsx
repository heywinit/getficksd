import { Button } from "@getficksd/ui/components/button";
import { PauseIcon, PlayIcon } from "lucide-react";
import { useMemo, useRef, useState, type PointerEvent } from "react";

import type { PlanRun, Scenario } from "@/lib/plan-run";

const VIEWBOX_WIDTH = 1000;
const PLOT_START = 0;
const PLOT_END = 1000;
const PLOT_WIDTH = PLOT_END - PLOT_START;
const SAMPLE_COUNT = 97;

type TimeRailProps = {
  currentHour: number;
  isPlaying: boolean;
  run?: PlanRun;
  scenario?: Scenario;
  onCurrentHourChange: (hour: number) => void;
  onPlayingChange: (isPlaying: boolean) => void;
};

export function TimeRail({
  currentHour,
  isPlaying,
  run,
  scenario,
  onCurrentHourChange,
  onPlayingChange,
}: TimeRailProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const data = useMemo(() => createTimeRailData(scenario, run), [run, scenario]);
  const cursorX = hourToX(currentHour);
  const deadlineHour = contractDeadlineHour(scenario);

  const setHourFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = plotRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const ratio = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    onCurrentHourChange(Math.round(ratio * 24 * 12) / 12);
  };

  const startScrub = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsScrubbing(true);
    onPlayingChange(false);
    setHourFromPointer(event);
  };

  const continueScrub = (event: PointerEvent<HTMLDivElement>) => {
    if (!isScrubbing) return;
    setHourFromPointer(event);
  };

  const endScrub = (event: PointerEvent<HTMLDivElement>) => {
    if (!isScrubbing) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsScrubbing(false);
  };

  return (
    <section
      data-time-rail
      className="absolute inset-x-0 bottom-0 z-30 h-28 border-t border-border bg-background/95 backdrop-blur"
      aria-label="Operating day timeline"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex h-full">
        <div className="flex w-28 shrink-0 flex-col justify-between border-r border-border p-2.5 sm:w-36">
          <div className="flex items-center gap-2">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={isPlaying ? "Pause operating day" : "Play operating day"}
              onClick={() => onPlayingChange(!isPlaying)}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </Button>
            <span className="font-mono text-sm font-medium text-foreground">
              {formatOperatingTime(currentHour, scenario)}
            </span>
          </div>
          <div>
            <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {run ? "Scheduled output" : "Demand forecast"}
            </p>
            <p className="mt-0.5 hidden text-[10px] text-muted-foreground sm:block">
              {formatOperatingDate(scenario)}
            </p>
          </div>
        </div>

        <div
          ref={plotRef}
          className={`relative min-w-0 flex-1 touch-none ${isScrubbing ? "cursor-grabbing" : "cursor-ew-resize"}`}
          onPointerDown={startScrub}
          onPointerMove={continueScrub}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
        >
          <div className="pointer-events-none absolute inset-x-0 top-2 grid grid-cols-5 font-mono text-[9px] text-muted-foreground">
            {[0, 6, 12, 18, 24].map((hour) => (
              <span key={hour} className="text-center first:text-left last:text-right">
                {formatOperatingTime(hour, scenario)}
              </span>
            ))}
          </div>

          <svg
            className="absolute inset-x-0 bottom-0 h-[86px] w-full overflow-visible"
            viewBox={`0 0 ${VIEWBOX_WIDTH} 100`}
            preserveAspectRatio="none"
            role="img"
            aria-label="Solar, wind, demand, battery, diesel, and contract timing"
          >
            {[0, 6, 12, 18, 24].map((hour) => (
              <line
                key={hour}
                x1={hourToX(hour)}
                x2={hourToX(hour)}
                y1="8"
                y2="94"
                stroke="var(--border)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            <path d={areaPath(data.solar, 18, 86)} fill="var(--chart-1)" fillOpacity="0.08" />
            <path d={areaPath(data.wind, 38, 86)} fill="var(--chart-2)" fillOpacity="0.06" />
            <path
              d={linePath(data.demand, 22, 86)}
              fill="none"
              stroke="var(--foreground)"
              strokeOpacity="0.48"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={linePath(data.battery, 18, 86)}
              fill="none"
              stroke="var(--chart-3)"
              strokeWidth="2.5"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />

            {data.dieselBlocks.map(([start, end]) => (
              <rect
                key={start}
                x={hourToX(start)}
                y="90"
                width={hourToX(end) - hourToX(start)}
                height="4"
                fill="var(--chart-4)"
              />
            ))}

            <line
              x1={hourToX(deadlineHour)}
              x2={hourToX(deadlineHour)}
              y1="8"
              y2="96"
              stroke="var(--chart-2)"
              strokeOpacity="0.7"
              strokeWidth="1"
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />

            <line
              x1={cursorX}
              x2={cursorX}
              y1="4"
              y2="96"
              stroke="var(--foreground)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={`M ${cursorX - 4} 4 L ${cursorX + 4} 4 L ${cursorX} 10 Z`}
              fill="var(--foreground)"
            />
          </svg>

          <span
            className="pointer-events-none absolute top-[19px] -translate-x-1/2 font-mono text-[9px] font-medium text-foreground"
            style={{ left: `${(currentHour / 24) * 100}%` }}
          >
            NOW
          </span>
          <span
            className={`pointer-events-none absolute bottom-1 whitespace-nowrap font-mono text-[8px] uppercase tracking-wide text-chart-2 ${deadlineHour >= 22 ? "-translate-x-full" : "-translate-x-1/2"}`}
            style={{ left: `${clamp((deadlineHour / 24) * 100, 2, 100)}%` }}
          >
            Pump · {formatOperatingTime(deadlineHour, scenario)}
          </span>
        </div>
      </div>
    </section>
  );
}

function createTimeRailData(scenario?: Scenario, run?: PlanRun) {
  const samples = Array.from({ length: SAMPLE_COUNT }, (_, index) => index / 4);
  const states = samples.map((hour) => operatingStateAt(hour, scenario, run));
  const solarCapacity = assetByType(scenario, "solar")?.capacity_kw ?? 1;
  const windCapacity = assetByType(scenario, "wind")?.capacity_kw ?? 1;
  const peakDemand = Math.max(1, ...states.map((state) => state.demandKw));
  return {
    solar: states.map((state) => state.solarKw / solarCapacity),
    wind: states.map((state) => state.windKw / windCapacity),
    demand: states.map((state) => state.demandKw / peakDemand),
    battery: states.map((state) => state.batteryPercent / 100),
    dieselBlocks: dieselBlocks(run),
  };
}

export function operatingStateAt(hour: number, scenario?: Scenario, run?: PlanRun) {
  const intervalCount = run?.intervals.length ?? scenario?.horizon.interval_count ?? 0;
  const index =
    intervalCount > 0 ? clamp(Math.floor((hour / 24) * intervalCount), 0, intervalCount - 1) : 0;
  const interval = run?.intervals[index];
  const solar = assetByType(scenario, "solar");
  const wind = assetByType(scenario, "wind");
  const battery = assetByType(scenario, "battery");
  const diesel = assetByType(scenario, "diesel");
  const clinic = serviceByMode(scenario, "fixed");
  const water = serviceByMode(scenario, "shiftable");
  const homes = serviceByMode(scenario, "curtailable");
  const solarOutput = interval?.renewables.find((item) => item.asset_id === solar?.id)?.used_kw;
  const windOutput = interval?.renewables.find((item) => item.asset_id === wind?.id)?.used_kw;
  const batteryInterval = interval?.batteries.find((item) => item.asset_id === battery?.id);
  const dieselInterval = interval?.generators.find((item) => item.asset_id === diesel?.id);
  const clinicDelivery = interval?.services.find((item) => item.service_id === clinic?.id);
  const waterDelivery = interval?.services.find((item) => item.service_id === water?.id);
  const homesDelivery = interval?.services.find((item) => item.service_id === homes?.id);
  const waterContract = scenario?.contracts.find((item) => item.service_id === water?.id);
  const waterContractState = interval?.contracts.find(
    (item) => item.contract_id === waterContract?.id,
  );
  const initialBattery = initialAssetState(scenario, battery?.id)?.stored_energy_kwh ?? 0;
  const initialFuel = initialAssetState(scenario, diesel?.id)?.fuel_available_liters ?? 0;
  const batteryEnergy = batteryInterval?.ending_energy_kwh ?? initialBattery;
  const batteryCapacity = battery?.capacity_kwh ?? 0;
  const serviceDemand = interval
    ? interval.services.reduce((total, item) => total + item.requested_kw, 0)
    : signalValue(scenario, "service_demand", index);
  return {
    solarKw: round(
      solarOutput ?? signalValue(scenario, "renewable_availability", index, solar?.id),
    ),
    windKw: round(windOutput ?? signalValue(scenario, "renewable_availability", index, wind?.id)),
    demandKw: round(serviceDemand),
    batteryPercent: batteryCapacity > 0 ? Math.round((batteryEnergy / batteryCapacity) * 100) : 0,
    batteryEnergyKwh: round(batteryEnergy),
    batteryCapacityKwh: round(batteryCapacity),
    dieselOn: dieselInterval?.running ?? false,
    dieselOutputKw: round(dieselInterval?.output_kw ?? 0),
    dieselCapacityKw: round(diesel?.maximum_output_kw ?? 0),
    dieselFuelLiters: round(dieselInterval?.fuel_remaining_liters ?? initialFuel),
    clinicDeliveredKw: round(
      clinicDelivery?.delivered_kw ?? demandForService(scenario, clinic?.id, index),
    ),
    waterDeliveredKw: round(waterDelivery?.delivered_kw ?? 0),
    waterContractStatus: waterContractState?.status,
    waterRuntimeRemainingMinutes: waterContractState?.remaining_runtime_minutes ?? 0,
    homesDeliveredKw: round(
      homesDelivery?.delivered_kw ?? demandForService(scenario, homes?.id, index),
    ),
    homesDeferredKw: round((homesDelivery?.deferred_kw ?? 0) + (homesDelivery?.unserved_kw ?? 0)),
    homesDeferred: (homesDelivery?.deferred_kw ?? 0) + (homesDelivery?.unserved_kw ?? 0) > 0.001,
    contractAtRisk:
      interval?.contracts.some(
        (contract) => contract.status === "at_risk" || contract.status === "breached",
      ) ?? false,
  };
}

function signalValue(
  scenario: Scenario | undefined,
  kind: Scenario["signals"][number]["kind"],
  index: number,
  assetId?: string,
) {
  return (scenario?.signals ?? [])
    .filter((signal) => signal.kind === kind && (!assetId || signal.asset_id === assetId))
    .reduce((total, signal) => total + (signal.values[index] ?? 0), 0);
}

function demandForService(
  scenario: Scenario | undefined,
  serviceId: string | undefined,
  index: number,
) {
  if (!serviceId) return 0;
  return (
    scenario?.signals.find(
      (signal) => signal.kind === "service_demand" && signal.service_id === serviceId,
    )?.values[index] ?? 0
  );
}

function assetByType(
  scenario: Scenario | undefined,
  type: Scenario["site"]["assets"][number]["type"],
) {
  return scenario?.site.assets.find((asset) => asset.type === type);
}

function serviceByMode(
  scenario: Scenario | undefined,
  mode: Scenario["site"]["services"][number]["control_mode"],
) {
  return scenario?.site.services.find((service) => service.control_mode === mode);
}

function initialAssetState(scenario: Scenario | undefined, assetId: string | undefined) {
  return scenario?.initial_state.assets.find((state) => state.asset_id === assetId);
}

function dieselBlocks(run?: PlanRun): Array<[number, number]> {
  if (!run || run.intervals.length === 0) return [];
  const hoursPerInterval = 24 / run.intervals.length;
  const blocks: Array<[number, number]> = [];
  let blockStart: number | undefined;
  run.intervals.forEach((interval, index) => {
    const running = interval.generators.some((generator) => generator.running);
    if (running && blockStart === undefined) blockStart = index * hoursPerInterval;
    if (!running && blockStart !== undefined) {
      blocks.push([blockStart, index * hoursPerInterval]);
      blockStart = undefined;
    }
  });
  if (blockStart !== undefined) blocks.push([blockStart, 24]);
  return blocks;
}

function contractDeadlineHour(scenario?: Scenario) {
  const contract = scenario?.contracts.find((item) => item.kind !== "continuous_power");
  if (!scenario || !contract) return 24;
  const elapsed =
    (new Date(contract.deadline).getTime() - new Date(scenario.horizon.starts_at).getTime()) /
    3_600_000;
  return clamp(elapsed, 0, 24);
}

function areaPath(values: number[], top: number, bottom: number) {
  const points = values.map((value, index) => {
    const x = PLOT_START + (index / (values.length - 1)) * PLOT_WIDTH;
    const y = bottom - value * (bottom - top);
    return `${x} ${y}`;
  });
  return `M ${PLOT_START} ${bottom} L ${points.join(" L ")} L ${PLOT_END} ${bottom} Z`;
}

function linePath(values: number[], top: number, bottom: number) {
  return values
    .map((value, index) => {
      const x = PLOT_START + (index / (values.length - 1)) * PLOT_WIDTH;
      const y = bottom - value * (bottom - top);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function hourToX(hour: number) {
  return PLOT_START + (hour / 24) * PLOT_WIDTH;
}

function formatOperatingTime(hour: number, scenario?: Scenario) {
  const startsAt = scenario?.horizon.starts_at;
  if (!startsAt) {
    const normalizedMinutes = Math.round(hour * 60);
    const hours = Math.floor(normalizedMinutes / 60) % 24;
    const minutes = normalizedMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }
  const timestamp = new Date(new Date(startsAt).getTime() + hour * 3_600_000);
  return new Intl.DateTimeFormat("en", {
    timeZone: scenario.site.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function formatOperatingDate(scenario?: Scenario) {
  if (!scenario) return "Waiting for scenario";
  return (
    new Intl.DateTimeFormat("en", {
      timeZone: scenario.site.timezone,
      day: "numeric",
      month: "short",
    }).format(new Date(scenario.horizon.starts_at)) + ` · ${scenario.site.location}`
  );
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}
