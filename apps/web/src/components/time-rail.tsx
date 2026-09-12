import { Button } from "@getficksd/ui/components/button";
import { ChevronDownIcon, ChevronUpIcon, PauseIcon, PlayIcon } from "lucide-react";
import { useMemo, useRef, useState, type PointerEvent } from "react";

import type { PlanRun, Scenario } from "@/lib/plan-run";

const VIEWBOX_WIDTH = 1000;
const PLOT_START = 0;
const PLOT_END = 1000;
const PLOT_WIDTH = PLOT_END - PLOT_START;
const SAMPLE_COUNT = 97;

type TimeRailProps = {
  currentHour: number;
  expanded: boolean;
  isPlaying: boolean;
  run?: PlanRun;
  scenario?: Scenario;
  onCurrentHourChange: (hour: number) => void;
  onExpandedChange: (expanded: boolean) => void;
  onPlayingChange: (isPlaying: boolean) => void;
};

export function TimeRail({
  currentHour,
  expanded,
  isPlaying,
  run,
  scenario,
  onCurrentHourChange,
  onExpandedChange,
  onPlayingChange,
}: TimeRailProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const data = useMemo(() => createTimeRailData(scenario, run), [run, scenario]);
  const cursorX = hourToX(currentHour);
  const deadlineHour = contractDeadlineHour(scenario);
  const eventWindows = planEventWindows(scenario, run);
  const activeEvents = activePlanEventsAt(currentHour, scenario, run);
  const togglePlayback = () => {
    if (!isPlaying && currentHour >= 24) onCurrentHourChange(0);
    onPlayingChange(!isPlaying);
  };

  if (!expanded) {
    return (
      <section
        data-time-rail
        className="absolute inset-x-0 bottom-0 z-30 h-12 overflow-hidden border-t border-border bg-background/95 backdrop-blur transition-[height] duration-300 ease-out motion-reduce:transition-none"
        aria-label="Replay controls"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div
          key="collapsed"
          className="flex h-full animate-in items-center gap-2 px-2.5 duration-200 fade-in slide-in-from-top-1 motion-reduce:animate-none"
        >
          <Button
            size="xs"
            variant="outline"
            aria-label={isPlaying ? "Pause replay" : "Start replay"}
            onClick={togglePlayback}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
            {isPlaying ? "Pause" : "Play"}
          </Button>
          <span className="whitespace-nowrap font-mono text-[10px] font-medium text-foreground sm:text-xs">
            Plan replay · {formatOperatingTime(currentHour, scenario)}
          </span>
          {activeEvents.length > 0 ? (
            <span className="hidden truncate rounded-full bg-chart-5/15 px-2 py-1 text-[9px] font-medium text-chart-5 sm:block">
              {activeEvents.map((event) => event.name).join(" · ")}
            </span>
          ) : null}
          <Button
            size="icon-xs"
            variant="ghost"
            className="ml-auto text-muted-foreground"
            aria-label="Expand replay timeline"
            aria-expanded={false}
            onClick={() => onExpandedChange(true)}
          >
            <ChevronUpIcon />
          </Button>
        </div>
      </section>
    );
  }

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
      className="absolute inset-x-0 bottom-0 z-30 h-28 overflow-hidden border-t border-border bg-background/95 backdrop-blur transition-[height] duration-300 ease-out motion-reduce:transition-none"
      aria-label="Operating day timeline"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        key="expanded"
        className="flex h-full animate-in duration-300 fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
      >
        <div className="flex w-32 shrink-0 flex-col justify-between border-r border-border p-2.5 sm:w-44">
          <div className="flex flex-col items-start gap-1.5">
            <Button
              size="xs"
              variant="outline"
              aria-label={isPlaying ? "Pause replay" : "Start replay"}
              onClick={togglePlayback}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
              {isPlaying ? "Pause" : "Play"}
            </Button>
            <span className="whitespace-nowrap font-mono text-[10px] font-medium text-foreground sm:text-xs">
              Plan replay · {formatOperatingTime(currentHour, scenario)}
            </span>
          </div>
          <p className="hidden truncate text-[10px] text-muted-foreground sm:block">
            {formatOperatingDate(scenario)}
          </p>
        </div>

        <div
          ref={plotRef}
          className={`relative min-w-0 flex-1 touch-none ${isScrubbing ? "cursor-grabbing" : "cursor-ew-resize"}`}
          onPointerDown={startScrub}
          onPointerMove={continueScrub}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
        >
          <div className="pointer-events-none absolute left-0 right-10 top-2 grid grid-cols-5 font-mono text-[9px] text-muted-foreground">
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

            {eventWindows.map((event) => (
              <rect
                key={event.id}
                x={hourToX(event.startHour)}
                y="10"
                width={Math.max(2, hourToX(event.endHour) - hourToX(event.startHour))}
                height="7"
                rx="3.5"
                fill="var(--chart-5)"
                fillOpacity={
                  activeEvents.some((activeEvent) => activeEvent.id === event.id) ? 0.7 : 0.22
                }
              >
                <title>{event.name}</title>
              </rect>
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
            className={`pointer-events-none absolute bottom-1 whitespace-nowrap font-mono text-[8px] uppercase tracking-wide text-chart-2 ${deadlineHour >= 22 ? "-translate-x-full" : "-translate-x-1/2"}`}
            style={{ left: `${clamp((deadlineHour / 24) * 100, 2, 100)}%` }}
          >
            Pump · {formatOperatingTime(deadlineHour, scenario)}
          </span>
        </div>
      </div>
      <Button
        size="icon-xs"
        variant="ghost"
        className="absolute right-2 top-2 z-10 text-muted-foreground"
        aria-label="Collapse replay timeline"
        aria-expanded={true}
        onClick={() => onExpandedChange(false)}
      >
        <ChevronDownIcon />
      </Button>
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
  const position = intervalCount > 0 ? clamp((hour / 24) * intervalCount, 0, intervalCount - 1) : 0;
  const index = Math.floor(position);
  const nextIndex = Math.min(index + 1, Math.max(0, intervalCount - 1));
  const progress = position - index;
  const interval = run?.intervals[index];
  const nextInterval = run?.intervals[nextIndex];
  const blend = (current: number | undefined, next: number | undefined) =>
    interpolate(current ?? next ?? 0, next ?? current ?? 0, progress);
  const solar = assetByType(scenario, "solar");
  const wind = assetByType(scenario, "wind");
  const battery = assetByType(scenario, "battery");
  const diesel = assetByType(scenario, "diesel");
  const clinic = serviceByMode(scenario, "fixed");
  const water = serviceByMode(scenario, "shiftable");
  const homes = serviceByMode(scenario, "curtailable");
  const solarOutput = interval?.renewables.find((item) => item.asset_id === solar?.id)?.used_kw;
  const nextSolarOutput = nextInterval?.renewables.find(
    (item) => item.asset_id === solar?.id,
  )?.used_kw;
  const windOutput = interval?.renewables.find((item) => item.asset_id === wind?.id)?.used_kw;
  const nextWindOutput = nextInterval?.renewables.find(
    (item) => item.asset_id === wind?.id,
  )?.used_kw;
  const batteryInterval = interval?.batteries.find((item) => item.asset_id === battery?.id);
  const nextBatteryInterval = nextInterval?.batteries.find((item) => item.asset_id === battery?.id);
  const dieselInterval = interval?.generators.find((item) => item.asset_id === diesel?.id);
  const nextDieselInterval = nextInterval?.generators.find((item) => item.asset_id === diesel?.id);
  const clinicDelivery = interval?.services.find((item) => item.service_id === clinic?.id);
  const nextClinicDelivery = nextInterval?.services.find((item) => item.service_id === clinic?.id);
  const waterDelivery = interval?.services.find((item) => item.service_id === water?.id);
  const nextWaterDelivery = nextInterval?.services.find((item) => item.service_id === water?.id);
  const homesDelivery = interval?.services.find((item) => item.service_id === homes?.id);
  const nextHomesDelivery = nextInterval?.services.find((item) => item.service_id === homes?.id);
  const waterContract = scenario?.contracts.find((item) => item.service_id === water?.id);
  const waterContractState = interval?.contracts.find(
    (item) => item.contract_id === waterContract?.id,
  );
  const initialBattery = initialAssetState(scenario, battery?.id)?.stored_energy_kwh ?? 0;
  const initialFuel = initialAssetState(scenario, diesel?.id)?.fuel_available_liters ?? 0;
  const batteryEnergy = blend(
    batteryInterval?.ending_energy_kwh ?? initialBattery,
    nextBatteryInterval?.ending_energy_kwh ?? initialBattery,
  );
  const batteryCapacity = battery?.capacity_kwh ?? 0;
  const serviceDemand = interval
    ? blend(
        interval.services.reduce((total, item) => total + item.requested_kw, 0),
        nextInterval?.services.reduce((total, item) => total + item.requested_kw, 0),
      )
    : interpolatedSignalValue(scenario, "service_demand", index, nextIndex, progress);
  const servedPower = interval
    ? blend(
        interval.services.reduce((total, item) => total + item.delivered_kw, 0),
        nextInterval?.services.reduce((total, item) => total + item.delivered_kw, 0),
      )
    : serviceDemand;
  const deferredPower = interval
    ? blend(
        interval.services.reduce((total, item) => total + item.deferred_kw + item.unserved_kw, 0),
        nextInterval?.services.reduce(
          (total, item) => total + item.deferred_kw + item.unserved_kw,
          0,
        ),
      )
    : 0;
  const renewableOutputByAsset = Object.fromEntries(
    (scenario?.site.assets ?? [])
      .filter((asset) => asset.type === "solar" || asset.type === "wind")
      .map((asset) => [
        asset.id,
        round(
          blend(
            interval?.renewables.find((item) => item.asset_id === asset.id)?.used_kw ??
              signalValue(scenario, "renewable_availability", index, asset.id),
            nextInterval?.renewables.find((item) => item.asset_id === asset.id)?.used_kw ??
              signalValue(scenario, "renewable_availability", nextIndex, asset.id),
          ),
        ),
      ]),
  );
  const batteriesByAsset = Object.fromEntries(
    (scenario?.site.assets ?? [])
      .filter((asset) => asset.type === "battery")
      .map((asset) => {
        const dispatch = interval?.batteries.find((item) => item.asset_id === asset.id);
        const nextDispatch = nextInterval?.batteries.find((item) => item.asset_id === asset.id);
        const initialEnergy = initialAssetState(scenario, asset.id)?.stored_energy_kwh ?? 0;
        const energy = blend(
          dispatch?.ending_energy_kwh ?? initialEnergy,
          nextDispatch?.ending_energy_kwh ?? initialEnergy,
        );
        const capacity = asset.capacity_kwh ?? 0;
        return [
          asset.id,
          {
            energyKwh: round(energy),
            capacityKwh: round(capacity),
            percent: capacity > 0 ? round((energy / capacity) * 100) : 0,
            chargeKw: round(blend(dispatch?.charge_kw, nextDispatch?.charge_kw)),
            dischargeKw: round(blend(dispatch?.discharge_kw, nextDispatch?.discharge_kw)),
          },
        ];
      }),
  );
  const generatorsByAsset = Object.fromEntries(
    (scenario?.site.assets ?? [])
      .filter((asset) => asset.type === "diesel")
      .map((asset) => {
        const dispatch = interval?.generators.find((item) => item.asset_id === asset.id);
        const nextDispatch = nextInterval?.generators.find((item) => item.asset_id === asset.id);
        const outputKw = blend(dispatch?.output_kw, nextDispatch?.output_kw);
        return [
          asset.id,
          {
            running: outputKw > 0.05,
            outputKw: round(outputKw),
            capacityKw: round(asset.maximum_output_kw ?? 0),
            fuelLiters: round(
              blend(
                dispatch?.fuel_remaining_liters ??
                  initialAssetState(scenario, asset.id)?.fuel_available_liters,
                nextDispatch?.fuel_remaining_liters ??
                  initialAssetState(scenario, asset.id)?.fuel_available_liters,
              ),
            ),
          },
        ];
      }),
  );
  const servicesByID = Object.fromEntries(
    (scenario?.site.services ?? []).map((service) => {
      const delivery = interval?.services.find((item) => item.service_id === service.id);
      const nextDelivery = nextInterval?.services.find((item) => item.service_id === service.id);
      return [
        service.id,
        {
          requestedKw: round(
            blend(
              delivery?.requested_kw ?? demandForService(scenario, service.id, index),
              nextDelivery?.requested_kw ?? demandForService(scenario, service.id, nextIndex),
            ),
          ),
          deliveredKw: round(
            blend(
              delivery?.delivered_kw ?? demandForService(scenario, service.id, index),
              nextDelivery?.delivered_kw ?? demandForService(scenario, service.id, nextIndex),
            ),
          ),
          deferredKw: round(
            blend(
              (delivery?.deferred_kw ?? 0) + (delivery?.unserved_kw ?? 0),
              (nextDelivery?.deferred_kw ?? 0) + (nextDelivery?.unserved_kw ?? 0),
            ),
          ),
        },
      ];
    }),
  );
  const contractsByService = Object.fromEntries(
    (scenario?.contracts ?? []).map((contract) => [
      contract.service_id,
      interval?.contracts.find((item) => item.contract_id === contract.id),
    ]),
  );
  return {
    solarKw: round(
      blend(
        solarOutput ?? signalValue(scenario, "renewable_availability", index, solar?.id),
        nextSolarOutput ?? signalValue(scenario, "renewable_availability", nextIndex, solar?.id),
      ),
    ),
    windKw: round(
      blend(
        windOutput ?? signalValue(scenario, "renewable_availability", index, wind?.id),
        nextWindOutput ?? signalValue(scenario, "renewable_availability", nextIndex, wind?.id),
      ),
    ),
    demandKw: round(serviceDemand),
    servedKw: round(servedPower),
    deferredKw: round(deferredPower),
    batteryPercent: batteryCapacity > 0 ? round((batteryEnergy / batteryCapacity) * 100) : 0,
    batteryEnergyKwh: round(batteryEnergy),
    batteryCapacityKwh: round(batteryCapacity),
    dieselOn: blend(dieselInterval?.output_kw, nextDieselInterval?.output_kw) > 0.05,
    dieselOutputKw: round(blend(dieselInterval?.output_kw, nextDieselInterval?.output_kw)),
    dieselCapacityKw: round(diesel?.maximum_output_kw ?? 0),
    dieselFuelLiters: round(
      blend(
        dieselInterval?.fuel_remaining_liters ?? initialFuel,
        nextDieselInterval?.fuel_remaining_liters ?? initialFuel,
      ),
    ),
    clinicDeliveredKw: round(
      blend(
        clinicDelivery?.delivered_kw ?? demandForService(scenario, clinic?.id, index),
        nextClinicDelivery?.delivered_kw ?? demandForService(scenario, clinic?.id, nextIndex),
      ),
    ),
    waterDeliveredKw: round(blend(waterDelivery?.delivered_kw, nextWaterDelivery?.delivered_kw)),
    waterContractStatus: waterContractState?.status,
    waterRuntimeRemainingMinutes: waterContractState?.remaining_runtime_minutes ?? 0,
    homesDeliveredKw: round(
      blend(
        homesDelivery?.delivered_kw ?? demandForService(scenario, homes?.id, index),
        nextHomesDelivery?.delivered_kw ?? demandForService(scenario, homes?.id, nextIndex),
      ),
    ),
    homesDeferredKw: round(
      blend(
        (homesDelivery?.deferred_kw ?? 0) + (homesDelivery?.unserved_kw ?? 0),
        (nextHomesDelivery?.deferred_kw ?? 0) + (nextHomesDelivery?.unserved_kw ?? 0),
      ),
    ),
    homesDeferred:
      blend(
        (homesDelivery?.deferred_kw ?? 0) + (homesDelivery?.unserved_kw ?? 0),
        (nextHomesDelivery?.deferred_kw ?? 0) + (nextHomesDelivery?.unserved_kw ?? 0),
      ) > 0.001,
    contractAtRisk:
      interval?.contracts.some(
        (contract) => contract.status === "at_risk" || contract.status === "breached",
      ) ?? false,
    renewableOutputByAsset,
    batteriesByAsset,
    generatorsByAsset,
    servicesByID,
    contractsByService,
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

function interpolatedSignalValue(
  scenario: Scenario | undefined,
  kind: Scenario["signals"][number]["kind"],
  index: number,
  nextIndex: number,
  progress: number,
  assetId?: string,
) {
  return interpolate(
    signalValue(scenario, kind, index, assetId),
    signalValue(scenario, kind, nextIndex, assetId),
    progress,
  );
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

type PlanEventWindow = Scenario["events"][number] & {
  startHour: number;
  endHour: number;
};

function planEventWindows(scenario?: Scenario, run?: PlanRun): PlanEventWindow[] {
  if (!scenario || !run) return [];
  const activeEventIDs = new Set(run.active_event_ids);
  const horizonStart = new Date(scenario.horizon.starts_at).getTime();
  const intervalHours = scenario.horizon.interval_minutes / 60;

  return scenario.events.flatMap((event) => {
    if (!activeEventIDs.has(event.id)) return [];
    const start = event.start ?? event.scheduled_at;
    const end = event.end ?? event.delayed_until;
    if (!start) return [];
    const startHour = clamp((new Date(start).getTime() - horizonStart) / 3_600_000, 0, 24);
    const endHour = end
      ? clamp((new Date(end).getTime() - horizonStart) / 3_600_000, startHour, 24)
      : Math.min(24, startHour + intervalHours);
    return [{ ...event, startHour, endHour: Math.max(startHour + 0.01, endHour) }];
  });
}

export function activePlanEventsAt(hour: number, scenario?: Scenario, run?: PlanRun) {
  return planEventWindows(scenario, run).filter(
    (event) => hour >= event.startHour && hour < event.endHour,
  );
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

export function formatOperatingTime(hour: number, scenario?: Scenario) {
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

function interpolate(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}
