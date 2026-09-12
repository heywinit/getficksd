import { Button } from "@getficksd/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@getficksd/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@getficksd/ui/components/dropdown-menu";
import { Input } from "@getficksd/ui/components/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BatteryChargingIcon,
  FuelIcon,
  HomeIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  ScrollTextIcon,
  SunIcon,
  WindIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { updateScenario } from "@/lib/backend";
import type { Scenario } from "@/lib/plan-run";

type AddKind = "battery" | "consumer" | "contract" | "diesel" | "event" | "solar" | "wind";
type Asset = Scenario["site"]["assets"][number];
export type GridEditTarget =
  | { kind: "asset"; id: string }
  | { kind: "contract"; id: string }
  | { kind: "event"; id: string }
  | { kind: "service"; id: string };

const selectClassName =
  "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const addItems = [
  { kind: "solar", label: "Solar array", icon: SunIcon, group: "Supply" },
  { kind: "wind", label: "Wind turbine", icon: WindIcon, group: "Supply" },
  {
    kind: "battery",
    label: "Battery",
    icon: BatteryChargingIcon,
    group: "Supply",
  },
  {
    kind: "diesel",
    label: "Diesel generator",
    icon: FuelIcon,
    group: "Supply",
  },
  { kind: "consumer", label: "Consumer", icon: HomeIcon, group: "Demand" },
  {
    kind: "contract",
    label: "Service contract",
    icon: ScrollTextIcon,
    group: "Rules",
  },
] as const;

export function GridActions({
  scenario,
  hasRun,
  isPlanning,
  onPlan,
  editRequest,
  onEditRequestHandled,
}: {
  scenario?: Scenario;
  hasRun: boolean;
  isPlanning: boolean;
  onPlan: () => void;
  editRequest?: GridEditTarget | null;
  onEditRequestHandled?: () => void;
}) {
  const queryClient = useQueryClient();
  const [editTarget, setEditTarget] = useState<GridEditTarget | null>(null);
  const [editDraft, setEditDraft] = useState<Scenario | null>(null);
  const addMutation = useMutation({
    mutationFn: async (kind: AddKind) => {
      if (!scenario) throw new Error("The grid is not available.");
      const next = structuredClone(scenario);
      const target = addToScenario(next, kind);
      const savedScenario = await updateScenario(next);
      return { savedScenario, target };
    },
    onSuccess: ({ savedScenario, target }, kind) => {
      queryClient.setQueryData(["scenario", savedScenario.id], savedScenario);
      queryClient.setQueryData(["plan-runs", savedScenario.id], []);
      setEditDraft(structuredClone(savedScenario));
      setEditTarget(target);
      toast.success(`${addItems.find((item) => item.kind === kind)?.label ?? "Item"} added`);
    },
    onError: (error) => toast.error(error.message),
  });
  const editMutation = useMutation({
    mutationFn: async (next: Scenario) => updateScenario(next),
    onSuccess: (savedScenario) => {
      queryClient.setQueryData(["scenario", savedScenario.id], savedScenario);
      queryClient.setQueryData(["plan-runs", savedScenario.id], []);
      setEditTarget(null);
      setEditDraft(null);
      toast.success("Changes saved");
    },
    onError: (error) => toast.error(error.message),
  });
  const disabled = !scenario || addMutation.isPending || editMutation.isPending;

  function startEdit(target: GridEditTarget) {
    if (!scenario) return;
    setEditDraft(structuredClone(scenario));
    setEditTarget(target);
  }

  const editedAsset =
    editTarget?.kind === "asset"
      ? editDraft?.site.assets.find((asset) => asset.id === editTarget.id)
      : undefined;
  const isRenewableEditor = editedAsset?.type === "solar" || editedAsset?.type === "wind";
  const isDieselEditor = editedAsset?.type === "diesel";

  useEffect(() => {
    if (!editRequest || !scenario) return;
    setEditDraft(structuredClone(scenario));
    setEditTarget(editRequest);
    onEditRequestHandled?.();
  }, [editRequest, onEditRequestHandled, scenario]);

  return (
    <div className="absolute left-4 top-4 z-30 flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="sm"
              variant="outline"
              className="h-8 bg-popover/95 shadow-xl backdrop-blur"
            />
          }
          disabled={disabled}
        >
          {addMutation.isPending ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}
          Add
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-52" align="start">
          {(["Supply", "Demand", "Rules"] as const).map((group, groupIndex) => (
            <div key={group}>
              {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuGroup>
                <DropdownMenuLabel>{group}</DropdownMenuLabel>
                {addItems
                  .filter((item) => item.group === group)
                  .map((item) => {
                    const Icon = item.icon;
                    const itemDisabled =
                      disabled ||
                      (item.kind === "contract" && scenario?.site.services.length === 0);
                    return (
                      <DropdownMenuItem
                        key={item.kind}
                        disabled={itemDisabled}
                        onClick={() => addMutation.mutate(item.kind)}
                      >
                        <Icon className="text-muted-foreground" />
                        {item.label}
                      </DropdownMenuItem>
                    );
                  })}
              </DropdownMenuGroup>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="sm"
              variant="outline"
              className="h-8 bg-popover/95 shadow-xl backdrop-blur"
            />
          }
          disabled={disabled}
        >
          <PencilIcon />
          Edit
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64" align="start">
          <EditMenu scenario={scenario} onEdit={startEdit} />
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        size="sm"
        className="h-8 gap-2 shadow-xl"
        disabled={!scenario || isPlanning}
        onClick={onPlan}
      >
        {isPlanning ? <LoaderCircleIcon className="animate-spin" /> : <PlayIcon />}
        {hasRun ? "Replan" : "Build plan"}
      </Button>

      <Dialog
        open={Boolean(editTarget && editDraft)}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null);
            setEditDraft(null);
          }
        }}
      >
        <DialogContent
          className={
            isDieselEditor ? "sm:max-w-3xl" : isRenewableEditor ? "sm:max-w-md" : "sm:max-w-lg"
          }
        >
          <DialogHeader>
            <DialogTitle>Edit {editTarget ? targetLabel(editTarget.kind) : "item"}</DialogTitle>
            <DialogDescription>
              Change this item without opening a grid-wide form.
            </DialogDescription>
          </DialogHeader>
          {editTarget && editDraft ? (
            <ItemEditor scenario={editDraft} target={editTarget} onChange={setEditDraft} />
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditTarget(null);
                setEditDraft(null);
              }}
              disabled={editMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => editDraft && editMutation.mutate(editDraft)}
              disabled={!editDraft || editMutation.isPending}
            >
              {editMutation.isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditMenu({
  scenario,
  onEdit,
}: {
  scenario?: Scenario;
  onEdit: (target: GridEditTarget) => void;
}) {
  if (!scenario) return null;
  const groups = [
    {
      label: "Supply",
      items: scenario.site.assets.map((item) => ({
        id: item.id,
        label: item.name,
        target: { kind: "asset", id: item.id } as const,
      })),
    },
    {
      label: "Consumers",
      items: scenario.site.services.map((item) => ({
        id: item.id,
        label: item.name,
        target: { kind: "service", id: item.id } as const,
      })),
    },
    {
      label: "Contracts",
      items: scenario.contracts.map((item) => ({
        id: item.id,
        label: item.name,
        target: { kind: "contract", id: item.id } as const,
      })),
    },
    {
      label: "Disruptions",
      items: scenario.events.map((item) => ({
        id: item.id,
        label: item.name,
        target: { kind: "event", id: item.id } as const,
      })),
    },
  ];

  return groups.map((group, index) => (
    <div key={group.label}>
      {index > 0 ? <DropdownMenuSeparator /> : null}
      <DropdownMenuGroup>
        <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
        {group.items.length === 0 ? (
          <p className="px-1.5 py-1 text-xs text-muted-foreground">None</p>
        ) : (
          group.items.map((item) => (
            <DropdownMenuItem key={item.id} onClick={() => onEdit(item.target)}>
              {item.label}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuGroup>
    </div>
  ));
}

function ItemEditor({
  scenario,
  target,
  onChange,
}: {
  scenario: Scenario;
  target: GridEditTarget;
  onChange: (scenario: Scenario) => void;
}) {
  const update = (change: (next: Scenario) => void) => {
    const next = structuredClone(scenario);
    change(next);
    onChange(next);
  };

  if (target.kind === "asset") {
    const asset = scenario.site.assets.find((item) => item.id === target.id);
    if (!asset) return <MissingItem />;
    const signal = scenario.signals.find(
      (item) => item.asset_id === asset.id && item.kind === "renewable_availability",
    );
    const state = scenario.initial_state.assets.find((item) => item.asset_id === asset.id);
    const setAsset = (field: keyof Asset, value: string | number) =>
      update((next) => {
        const item = next.site.assets.find((candidate) => candidate.id === asset.id);
        if (item) (item[field] as typeof value) = value;
      });
    if (asset.type === "solar" || asset.type === "wind") {
      const capacity = asset.capacity_kw ?? 0.01;
      const output = average(signal?.values ?? []);
      const updateCapacity = (value: number) =>
        update((next) => {
          const item = next.site.assets.find((candidate) => candidate.id === asset.id);
          if (item) item.capacity_kw = value;
          const forecast = next.signals.find((candidate) => candidate.id === signal?.id);
          if (forecast) {
            forecast.values = forecast.values.map((currentOutput) =>
              Math.min(currentOutput, value),
            );
          }
        });
      const updateOutput = (value: number) =>
        update((next) => {
          const item = next.signals.find((candidate) => candidate.id === signal?.id);
          if (item) item.values = item.values.map(() => value);
        });

      return (
        <div className="grid gap-4 py-1">
          <TextField
            label="Name"
            value={asset.name}
            onChange={(value) => setAsset("name", value)}
          />
          <div className="grid gap-3 rounded-xl border border-border bg-card p-3">
            <div>
              <p className="text-sm font-medium">Quick output settings</p>
              <p className="text-xs text-muted-foreground">
                Set the installed capacity and the forecast output for every interval.
              </p>
            </div>
            <RangeNumberField
              label="Installed capacity"
              value={capacity}
              min={0.01}
              sliderMax={Math.max(500, capacity)}
              step={1}
              unit="kW"
              onChange={updateCapacity}
            />
            <RangeNumberField
              label="Forecast output"
              value={output}
              min={0}
              inputMax={capacity}
              sliderMax={capacity}
              step={1}
              unit="kW"
              onChange={updateOutput}
            />
          </div>
        </div>
      );
    }

    if (asset.type === "diesel") {
      const fuelAvailable = state?.fuel_available_liters ?? 0;
      const minimumOutput = asset.minimum_output_kw ?? 0;
      const maximumOutput = asset.maximum_output_kw ?? 0.01;
      const startupFuel = asset.startup_fuel_liters ?? 0;
      const minimumRuntime = asset.minimum_runtime_minutes ?? 0;
      const rampRate = asset.ramp_rate_kw_per_minute ?? 0.01;
      const fuelCost = asset.fuel_cost_per_liter ?? 0;
      const setFuelAvailable = (value: number) =>
        update((next) => {
          const item = next.initial_state.assets.find(
            (candidate) => candidate.asset_id === asset.id,
          );
          if (item) item.fuel_available_liters = Math.max(0, value);
        });

      return (
        <div className="grid max-h-[65svh] gap-4 overflow-y-auto py-1 pr-1">
          <TextField
            label="Name"
            value={asset.name}
            onChange={(value) => setAsset("name", value)}
          />

          <section className="grid gap-3 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Fuel available</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {formatNumber(fuelAvailable)} L
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5" aria-label="Add fuel">
                {[25, 50, 100, 200].map((liters) => (
                  <Button
                    key={liters}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => setFuelAvailable(fuelAvailable + liters)}
                  >
                    +{liters} L
                  </Button>
                ))}
              </div>
            </div>
            <RangeNumberField
              label="Fuel inventory"
              value={fuelAvailable}
              min={0}
              sliderMax={Math.max(1_000, fuelAvailable)}
              step={5}
              inputStep={1}
              unit="L"
              onChange={setFuelAvailable}
            />
          </section>

          <section className="grid gap-3 rounded-xl border border-border bg-card p-4">
            <div>
              <p className="text-sm font-medium">Output range</p>
              <p className="text-xs text-muted-foreground">
                Set the stable operating floor and the generator limit.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <RangeNumberField
                label="Minimum output"
                value={minimumOutput}
                min={0}
                inputMax={maximumOutput}
                sliderMax={maximumOutput}
                step={1}
                unit="kW"
                onChange={(value) => setAsset("minimum_output_kw", Math.min(value, maximumOutput))}
              />
              <RangeNumberField
                label="Maximum output"
                value={maximumOutput}
                min={0.01}
                sliderMax={Math.max(500, maximumOutput)}
                step={1}
                unit="kW"
                onChange={(value) =>
                  update((next) => {
                    const item = next.site.assets.find((candidate) => candidate.id === asset.id);
                    if (!item) return;
                    item.maximum_output_kw = value;
                    item.minimum_output_kw = Math.min(item.minimum_output_kw ?? 0, value);
                  })
                }
              />
            </div>
          </section>

          <section className="grid gap-3 rounded-xl border border-border bg-card p-4">
            <div>
              <p className="text-sm font-medium">Generator behavior</p>
              <p className="text-xs text-muted-foreground">
                Tune how quickly the generator can start and change output.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <RangeNumberField
                label="Startup fuel"
                value={startupFuel}
                min={0}
                sliderMax={Math.max(10, startupFuel)}
                step={0.1}
                unit="L"
                onChange={(value) => setAsset("startup_fuel_liters", value)}
              />
              <RangeNumberField
                label="Minimum runtime"
                value={minimumRuntime}
                min={0}
                sliderMax={Math.max(240, minimumRuntime)}
                step={15}
                unit="min"
                onChange={(value) => setAsset("minimum_runtime_minutes", Math.round(value))}
              />
              <RangeNumberField
                label="Ramp rate"
                value={rampRate}
                min={0.01}
                sliderMax={Math.max(20, rampRate)}
                step={0.1}
                unit="kW/min"
                onChange={(value) => setAsset("ramp_rate_kw_per_minute", value)}
              />
            </div>
          </section>

          <section className="grid gap-3 rounded-xl border border-border bg-card p-4">
            <div>
              <p className="text-sm font-medium">Fuel economics</p>
              <p className="text-xs text-muted-foreground">
                The plan uses these values for cost and emissions estimates.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <NumberField
                label="Fuel use (liters/kWh)"
                value={asset.liters_per_kwh}
                min={0.001}
                step={0.001}
                onChange={(value) => setAsset("liters_per_kwh", value)}
              />
              <RangeNumberField
                label="Fuel cost"
                value={fuelCost}
                min={0}
                sliderMax={Math.max(500, fuelCost)}
                step={0.5}
                inputStep={0.01}
                unit={`${scenario.site.currency}/L`}
                onChange={(value) => setAsset("fuel_cost_per_liter", value)}
              />
              <NumberField
                label="Emissions (kg CO₂/liter)"
                value={asset.emissions_kg_co2_per_liter}
                min={0.01}
                step={0.01}
                onChange={(value) => setAsset("emissions_kg_co2_per_liter", value)}
              />
            </div>
          </section>
        </div>
      );
    }

    return (
      <div className="grid max-h-[60svh] gap-3 overflow-y-auto py-1 sm:grid-cols-2">
        <TextField label="Name" value={asset.name} onChange={(value) => setAsset("name", value)} />
        {asset.type === "battery" ? (
          <>
            <NumberField
              label="Capacity (kWh)"
              value={asset.capacity_kwh}
              min={0.01}
              onChange={(value) =>
                update((next) => {
                  const item = next.site.assets.find((candidate) => candidate.id === asset.id);
                  const itemState = next.initial_state.assets.find(
                    (candidate) => candidate.asset_id === asset.id,
                  );
                  if (!item) return;

                  item.capacity_kwh = value;
                  item.minimum_stored_energy_kwh = Math.min(
                    item.minimum_stored_energy_kwh ?? 0,
                    Math.max(0, value - 0.01),
                  );
                  reconcileBatteryLimits(next, item.id, itemState);
                })
              }
            />
            <NumberField
              label="Physical minimum (kWh)"
              value={asset.minimum_stored_energy_kwh}
              min={0}
              max={Math.max(0, (asset.capacity_kwh ?? 0.01) - 0.01)}
              onChange={(value) =>
                update((next) => {
                  const item = next.site.assets.find((candidate) => candidate.id === asset.id);
                  if (!item) return;
                  item.minimum_stored_energy_kwh = Math.min(
                    value,
                    Math.max(0, (item.capacity_kwh ?? 0.01) - 0.01),
                  );
                  reconcileBatteryLimits(next, item.id);
                })
              }
            />
            <NumberField
              label="Stored energy (kWh)"
              value={state?.stored_energy_kwh}
              min={0}
              max={asset.capacity_kwh}
              onChange={(value) =>
                update((next) => {
                  const item = next.initial_state.assets.find(
                    (candidate) => candidate.asset_id === asset.id,
                  );
                  if (item) {
                    item.stored_energy_kwh = Math.min(
                      Math.max(value, asset.minimum_stored_energy_kwh ?? 0),
                      asset.capacity_kwh ?? value,
                    );
                  }
                })
              }
            />
            <NumberField
              label="Maximum charge (kW)"
              value={asset.max_charge_kw}
              min={0.01}
              onChange={(value) => setAsset("max_charge_kw", value)}
            />
            <NumberField
              label="Maximum discharge (kW)"
              value={asset.max_discharge_kw}
              min={0.01}
              onChange={(value) => setAsset("max_discharge_kw", value)}
            />
            <NumberField
              label="Charge efficiency"
              value={asset.charge_efficiency}
              min={0.01}
              max={1}
              step={0.01}
              onChange={(value) => setAsset("charge_efficiency", value)}
            />
            <NumberField
              label="Discharge efficiency"
              value={asset.discharge_efficiency}
              min={0.01}
              max={1}
              step={0.01}
              onChange={(value) => setAsset("discharge_efficiency", value)}
            />
          </>
        ) : null}
      </div>
    );
  }

  if (target.kind === "service") {
    const service = scenario.site.services.find((item) => item.id === target.id);
    if (!service) return <MissingItem />;
    const signal = scenario.signals.find(
      (item) => item.service_id === service.id && item.kind === "service_demand",
    );
    return (
      <div className="grid gap-3 py-1 sm:grid-cols-2">
        <TextField
          label="Name"
          value={service.name}
          onChange={(value) =>
            update((next) => {
              const item = next.site.services.find((candidate) => candidate.id === service.id);
              if (item) item.name = value;
            })
          }
        />
        <TextField
          label="Description"
          value={service.description}
          onChange={(value) =>
            update((next) => {
              const item = next.site.services.find((candidate) => candidate.id === service.id);
              if (item) item.description = value;
            })
          }
        />
        <NumberField
          label="Rated power (kW)"
          value={service.rated_power_kw}
          min={0.01}
          onChange={(value) =>
            update((next) => {
              const item = next.site.services.find((candidate) => candidate.id === service.id);
              if (item) item.rated_power_kw = value;
              const demand = next.signals.find((candidate) => candidate.id === signal?.id);
              if (demand) demand.values = demand.values.map((power) => Math.min(power, value));
              next.contracts.forEach((candidate) => {
                if (candidate.service_id !== service.id) return;
                if (candidate.minimum_power_kw !== undefined) {
                  candidate.minimum_power_kw = Math.min(candidate.minimum_power_kw, value);
                }
                if (candidate.required_energy_kwh !== undefined) {
                  const windowHours =
                    (new Date(candidate.deadline).getTime() -
                      new Date(candidate.window_start).getTime()) /
                    3_600_000;
                  candidate.required_energy_kwh = Math.min(
                    candidate.required_energy_kwh,
                    value * windowHours,
                  );
                }
              });
            })
          }
        />
        <NumberField
          label="Demand for each interval (kW)"
          value={average(signal?.values ?? [])}
          min={0}
          max={service.rated_power_kw}
          onChange={(value) =>
            update((next) => {
              const item = next.signals.find((candidate) => candidate.id === signal?.id);
              if (item) item.values = item.values.map(() => value);
            })
          }
        />
        <label className="grid gap-1.5 text-sm font-medium">
          Control mode
          <select
            className={selectClassName}
            value={service.control_mode}
            onChange={(event) =>
              update((next) => {
                const item = next.site.services.find((candidate) => candidate.id === service.id);
                if (item) item.control_mode = event.target.value as typeof item.control_mode;
              })
            }
          >
            <option value="fixed">Fixed</option>
            <option value="curtailable">Curtailable</option>
            <option value="shiftable">Shiftable</option>
          </select>
        </label>
      </div>
    );
  }

  if (target.kind === "contract") {
    const contract = scenario.contracts.find((item) => item.id === target.id);
    if (!contract) return <MissingItem />;
    const setContract = (field: keyof typeof contract, value: string | number) =>
      update((next) => {
        const item = next.contracts.find((candidate) => candidate.id === contract.id);
        if (item) (item[field] as typeof value) = value;
      });
    return (
      <div className="grid gap-3 py-1 sm:grid-cols-2">
        <TextField
          label="Name"
          value={contract.name}
          onChange={(value) => setContract("name", value)}
        />
        <label className="grid gap-1.5 text-sm font-medium">
          Consumer
          <select
            className={selectClassName}
            value={contract.service_id}
            onChange={(event) =>
              update((next) => {
                const item = next.contracts.find((candidate) => candidate.id === contract.id);
                const service = next.site.services.find(
                  (candidate) => candidate.id === event.target.value,
                );
                if (!item || !service) return;
                item.service_id = service.id;
                if (item.minimum_power_kw !== undefined) {
                  item.minimum_power_kw = Math.min(item.minimum_power_kw, service.rated_power_kw);
                }
                if (item.required_energy_kwh !== undefined) {
                  const windowHours =
                    (new Date(item.deadline).getTime() - new Date(item.window_start).getTime()) /
                    3_600_000;
                  item.required_energy_kwh = Math.min(
                    item.required_energy_kwh,
                    service.rated_power_kw * windowHours,
                  );
                }
              })
            }
          >
            {scenario.site.services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Priority
          <select
            className={selectClassName}
            value={contract.priority}
            onChange={(event) => setContract("priority", event.target.value)}
          >
            <option value="critical">Critical</option>
            <option value="essential">Essential</option>
            <option value="flexible">Flexible</option>
          </select>
        </label>
        {contract.kind === "continuous_power" ? (
          <NumberField
            label="Minimum power (kW)"
            value={contract.minimum_power_kw}
            min={0.01}
            max={
              scenario.site.services.find((service) => service.id === contract.service_id)
                ?.rated_power_kw
            }
            onChange={(value) => setContract("minimum_power_kw", value)}
          />
        ) : contract.kind === "runtime_by_deadline" ? (
          <NumberField
            label="Required runtime (minutes)"
            value={contract.required_runtime_minutes}
            min={1}
            onChange={(value) => setContract("required_runtime_minutes", value)}
          />
        ) : (
          <NumberField
            label="Required energy (kWh)"
            value={contract.required_energy_kwh}
            min={0.01}
            onChange={(value) => setContract("required_energy_kwh", value)}
          />
        )}
      </div>
    );
  }

  const event = scenario.events.find((item) => item.id === target.id);
  if (!event) return <MissingItem />;
  const matchingSignals = scenario.signals.filter((signal) =>
    event.type === "renewable_shortfall"
      ? signal.kind === "renewable_availability"
      : event.type === "demand_surge"
        ? signal.kind === "service_demand"
        : signal.kind === "fuel_delivery",
  );
  return (
    <div className="grid gap-3 py-1 sm:grid-cols-2">
      <TextField
        label="Name"
        value={event.name}
        onChange={(value) =>
          update((next) => {
            const item = next.events.find((candidate) => candidate.id === event.id);
            if (item) item.name = value;
          })
        }
      />
      <label className="grid gap-1.5 text-sm font-medium">
        Affected forecast
        <select
          className={selectClassName}
          value={event.signal_id}
          onChange={(changeEvent) =>
            update((next) => {
              const item = next.events.find((candidate) => candidate.id === event.id);
              if (item) item.signal_id = changeEvent.target.value;
            })
          }
        >
          {matchingSignals.map((signal) => (
            <option key={signal.id} value={signal.id}>
              {signalName(signal, scenario)}
            </option>
          ))}
        </select>
      </label>
      {event.type === "renewable_shortfall" ? (
        <NumberField
          label="Available output multiplier"
          value={event.availability_multiplier}
          min={0}
          max={1}
          step={0.05}
          onChange={(value) =>
            update((next) => {
              const item = next.events.find((candidate) => candidate.id === event.id);
              if (item) item.availability_multiplier = value;
            })
          }
        />
      ) : event.type === "demand_surge" ? (
        <NumberField
          label="Demand multiplier"
          value={event.demand_multiplier}
          min={1.01}
          step={0.05}
          onChange={(value) =>
            update((next) => {
              const item = next.events.find((candidate) => candidate.id === event.id);
              if (item) item.demand_multiplier = value;
            })
          }
        />
      ) : null}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value?: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <Input
        type="number"
        value={value ?? ""}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function RangeNumberField({
  label,
  value,
  onChange,
  min,
  sliderMax,
  inputMax,
  step,
  inputStep,
  unit,
}: {
  label: string;
  value?: number;
  onChange: (value: number) => void;
  min: number;
  sliderMax: number;
  inputMax?: number;
  step: number;
  inputStep?: number;
  unit: string;
}) {
  const currentValue = value ?? min;
  const rangeValue = Math.min(Math.max(currentValue, min), sliderMax);

  return (
    <div className="grid gap-2 rounded-lg border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium" htmlFor={`${fieldId(label)}-range`}>
          {label}
        </label>
        <span className="text-sm font-semibold tabular-nums">
          {formatNumber(currentValue)} {unit}
        </span>
      </div>
      <input
        id={`${fieldId(label)}-range`}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
        type="range"
        value={rangeValue}
        min={min}
        max={sliderMax}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Exact
        <Input
          className="h-8 min-w-0 flex-1 text-foreground"
          type="number"
          value={value ?? ""}
          min={min}
          max={inputMax}
          step={inputStep ?? step}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="shrink-0">{unit}</span>
      </label>
    </div>
  );
}

function MissingItem() {
  return <p className="text-sm text-destructive">This item no longer exists.</p>;
}

function targetLabel(kind: GridEditTarget["kind"]) {
  return kind === "service" ? "consumer" : kind;
}

function signalName(signal: Scenario["signals"][number], scenario: Scenario) {
  if (signal.asset_id) {
    return scenario.site.assets.find((asset) => asset.id === signal.asset_id)?.name ?? signal.id;
  }
  if (signal.service_id) {
    return (
      scenario.site.services.find((service) => service.id === signal.service_id)?.name ?? signal.id
    );
  }
  return signal.id;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10;
}

function fieldId(label: string) {
  return `grid-control-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function reconcileBatteryLimits(
  scenario: Scenario,
  assetId: string,
  knownState?: Scenario["initial_state"]["assets"][number],
) {
  const asset = scenario.site.assets.find((candidate) => candidate.id === assetId);
  if (!asset || asset.type !== "battery") return;

  const capacity = asset.capacity_kwh ?? 0;
  const minimum = asset.minimum_stored_energy_kwh ?? 0;
  const state =
    knownState ?? scenario.initial_state.assets.find((candidate) => candidate.asset_id === assetId);
  if (state?.stored_energy_kwh !== undefined) {
    state.stored_energy_kwh = Math.min(Math.max(state.stored_energy_kwh, minimum), capacity);
  }

  const limits = scenario.site.assets
    .filter((candidate) => candidate.type === "battery")
    .reduce(
      (totals, candidate) => ({
        capacity: totals.capacity + (candidate.capacity_kwh ?? 0),
        minimum: totals.minimum + (candidate.minimum_stored_energy_kwh ?? 0),
      }),
      { capacity: 0, minimum: 0 },
    );
  scenario.operating_policy.reserve_energy_kwh = Math.min(
    Math.max(scenario.operating_policy.reserve_energy_kwh, limits.minimum),
    limits.capacity,
  );
}

function addToScenario(scenario: Scenario, kind: AddKind) {
  if (kind === "consumer") return addConsumer(scenario);
  if (kind === "contract") return addContract(scenario);
  if (kind === "event") return addEvent(scenario);
  return addAsset(scenario, kind);
}

function addAsset(scenario: Scenario, type: Asset["type"]) {
  const id = uniqueId(
    type,
    scenario.site.assets.map((asset) => asset.id),
  );
  const asset: Asset =
    type === "solar" || type === "wind"
      ? { id, name: `New ${type}`, type, capacity_kw: 10 }
      : type === "battery"
        ? {
            id,
            name: "New battery",
            type,
            capacity_kwh: 20,
            minimum_stored_energy_kwh: 2,
            max_charge_kw: 10,
            max_discharge_kw: 10,
            charge_efficiency: 0.95,
            discharge_efficiency: 0.95,
          }
        : {
            id,
            name: "New diesel generator",
            type,
            minimum_output_kw: 0,
            maximum_output_kw: 20,
            liters_per_kwh: 0.3,
            startup_fuel_liters: 0.5,
            minimum_runtime_minutes: 30,
            ramp_rate_kw_per_minute: 2,
            fuel_cost_per_liter: scenario.site.currency === "INR" ? 95 : 1,
            emissions_kg_co2_per_liter: 2.68,
          };
  scenario.site.assets.push(asset);
  if (type === "battery") {
    scenario.initial_state.assets.push({
      asset_id: id,
      type,
      stored_energy_kwh: 10,
    });
    const physicalMinimum = scenario.site.assets
      .filter((candidate) => candidate.type === "battery")
      .reduce((total, candidate) => total + (candidate.minimum_stored_energy_kwh ?? 0), 0);
    scenario.operating_policy.reserve_energy_kwh = Math.max(
      scenario.operating_policy.reserve_energy_kwh,
      physicalMinimum,
    );
  }
  if (type === "diesel") {
    scenario.initial_state.assets.push({
      asset_id: id,
      type,
      fuel_available_liters: 100,
      running: false,
    });
  }
  if (type === "solar" || type === "wind") {
    scenario.signals.push({
      id: `${id}-forecast`,
      kind: "renewable_availability",
      asset_id: id,
      unit: "kW",
      values: Array(scenario.horizon.interval_count).fill(0),
    });
  }
  return { kind: "asset", id } as const;
}

function addConsumer(scenario: Scenario) {
  const id = uniqueId(
    "consumer",
    scenario.site.services.map((service) => service.id),
  );
  scenario.site.services.push({
    id,
    name: "New consumer",
    description: "Flexible consumer load",
    control_mode: "curtailable",
    rated_power_kw: 5,
  });
  scenario.signals.push({
    id: `${id}-demand`,
    kind: "service_demand",
    service_id: id,
    unit: "kW",
    values: Array(scenario.horizon.interval_count).fill(0),
  });
  return { kind: "service", id } as const;
}

function addContract(scenario: Scenario) {
  const id = uniqueId(
    "contract",
    scenario.contracts.map((contract) => contract.id),
  );
  const service = scenario.site.services[0];
  scenario.contracts.push({
    id,
    name: "New continuous service",
    service_id: service?.id ?? "",
    kind: "continuous_power",
    priority: "essential",
    window_start: scenario.horizon.starts_at,
    deadline: horizonEnd(scenario),
    minimum_power_kw: Math.min(1, service?.rated_power_kw ?? 1),
  });
  return { kind: "contract", id } as const;
}

function addEvent(scenario: Scenario) {
  const signal =
    scenario.signals.find((item) => item.kind === "renewable_availability") ??
    scenario.signals.find((item) => item.kind === "service_demand") ??
    scenario.signals.find((item) => item.kind === "fuel_delivery");
  if (!signal) throw new Error("Add a supply forecast or consumer before a disruption.");

  const id = uniqueId(
    "event",
    scenario.events.map((event) => event.id),
  );
  const start = scenario.horizon.starts_at;
  const end = horizonEnd(scenario);
  if (signal.kind === "renewable_availability") {
    scenario.events.push({
      id,
      name: "New renewable shortfall",
      type: "renewable_shortfall",
      signal_id: signal.id,
      start,
      end,
      availability_multiplier: 0.8,
    });
  } else if (signal.kind === "service_demand") {
    scenario.events.push({
      id,
      name: "New demand surge",
      type: "demand_surge",
      signal_id: signal.id,
      start,
      end,
      demand_multiplier: 1.2,
    });
  } else {
    scenario.events.push({
      id,
      name: "New fuel delivery delay",
      type: "fuel_delivery_delay",
      signal_id: signal.id,
      scheduled_at: start,
      delayed_until: end,
    });
  }
  return { kind: "event", id } as const;
}

function horizonEnd(scenario: Scenario) {
  return new Date(
    new Date(scenario.horizon.starts_at).getTime() +
      scenario.horizon.interval_minutes * scenario.horizon.interval_count * 60_000,
  ).toISOString();
}

function uniqueId(prefix: string, existingIds: string[]) {
  let index = 1;
  while (existingIds.includes(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}
