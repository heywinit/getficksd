import { Button } from "@getficksd/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@getficksd/ui/components/dialog";
import { Input } from "@getficksd/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@getficksd/ui/components/select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  CloudSunIcon,
  LoaderCircleIcon,
  MinusIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SparklesIcon,
  Trash2Icon,
  WindIcon,
} from "lucide-react";
import { useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { toast } from "sonner";

import { createScenario } from "@/lib/backend";
import type { PlanRun, Scenario, ScenarioSummary } from "@/lib/plan-run";

type SupplyPreset = "cloudy" | "low-wind" | "normal";
type CurvePoint = { id: string; hour: number; value: number };

const demandPresets = {
  balanced: [38, 34, 31, 42, 58, 62, 78, 54, 38],
  evening: [30, 27, 25, 34, 48, 60, 96, 72, 34],
  productive: [34, 31, 42, 72, 82, 76, 68, 48, 34],
} as const;
type DemandPreset = keyof typeof demandPresets;

export function ScenarioRunner({
  scenarios,
  scenario,
  selectedScenarioID,
  run,
  isPlanning,
  isDeleting,
  isPlaying,
  onSelectScenario,
  onRun,
  onPause,
  onRepeat,
  onDeleteScenario,
}: {
  scenarios: ScenarioSummary[];
  scenario?: Scenario;
  selectedScenarioID: string;
  run?: PlanRun;
  isPlanning: boolean;
  isDeleting: boolean;
  isPlaying: boolean;
  onSelectScenario: (scenarioID: string) => void;
  onRun: () => void;
  onPause: () => void;
  onRepeat: () => void;
  onDeleteScenario: (scenarioID: string) => Promise<void>;
}) {
  const [designerOpen, setDesignerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const state = isPlanning ? "Calculating" : isPlaying ? "Playing" : run ? "Paused" : "Ready";
  const canDelete = scenarios.length > 1;
  const deleteSelectedScenario = async () => {
    if (!scenario) return;
    try {
      await onDeleteScenario(scenario.id);
      setDeleteOpen(false);
    } catch {
      // The parent mutation shows the backend error.
    }
  };

  return (
    <section
      className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card"
      aria-label="Scenario runner"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CalendarClockIcon className="size-4 text-primary" />
            <h2 className="text-base font-semibold tracking-tight">Scenario control</h2>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {scenario?.name ?? "Choose an operating day"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            aria-label="Delete active scenario"
            title={
              canDelete
                ? "Delete active scenario"
                : "Create another scenario before deleting this one"
            }
            onClick={() => setDeleteOpen(true)}
            disabled={!scenario || !canDelete || isDeleting}
          >
            {isDeleting ? <LoaderCircleIcon className="animate-spin" /> : <Trash2Icon />}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDesignerOpen(true)}
            disabled={!scenario}
          >
            <SparklesIcon />
            Design
          </Button>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-4">
        <div>
          <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Operating day
          </label>
          <Select
            value={selectedScenarioID}
            onValueChange={(value) => value && onSelectScenario(value)}
          >
            <SelectTrigger className="h-11 w-full bg-background" aria-label="Select scenario">
              <SelectValue placeholder="Select a scenario">
                {scenarios.find((item) => item.id === selectedScenarioID)?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="start">
              {scenarios.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{item.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      Revision {item.revision} · {item.contract_count} commitments
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <ScenarioMetric
            icon={AlertTriangleIcon}
            label="Disruptions"
            value={scenario ? String(scenario.events.length) : "—"}
          />
          <ScenarioMetric
            icon={ShieldCheckIcon}
            label="Commitments"
            value={scenario ? String(scenario.contracts.length) : "—"}
          />
          <ScenarioMetric
            icon={CalendarClockIcon}
            label="Revision"
            value={scenario ? String(scenario.revision) : "—"}
          />
        </div>

        <div className="min-h-16 rounded-lg border border-border bg-background p-2.5">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Stress events
          </p>
          <div className="flex flex-wrap gap-1.5">
            {scenario?.events.length ? (
              scenario.events.slice(0, 3).map((event) => (
                <span
                  key={event.id}
                  className="max-w-full truncate rounded-full border border-border bg-muted/50 px-2 py-1 text-[10px] text-foreground"
                  title={event.name}
                >
                  {event.name}
                </span>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">No disruptions configured.</span>
            )}
          </div>
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-2">
          <div className="flex items-center gap-2 px-1.5 text-xs font-medium">
            <span
              className={`size-2 rounded-full ${isPlanning || isPlaying ? "bg-primary" : "bg-muted-foreground/40"}`}
            />
            <div>
              <p>{state}</p>
              <p className="text-[10px] font-normal text-muted-foreground">
                {run ? "24-hour plan available" : "No calculated plan"}
              </p>
            </div>
          </div>
          <div className="flex items-center rounded-full border border-border bg-card p-1">
            <Button
              size="icon-sm"
              variant="ghost"
              className="rounded-full"
              aria-label={run ? "Play scenario" : "Calculate and play scenario"}
              disabled={!scenario || isPlanning}
              onClick={onRun}
            >
              {isPlanning ? <LoaderCircleIcon className="animate-spin" /> : <PlayIcon />}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="rounded-full"
              aria-label="Pause scenario"
              disabled={!run || !isPlaying}
              onClick={onPause}
            >
              <PauseIcon />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="rounded-full"
              aria-label="Repeat scenario"
              disabled={!run || isPlanning}
              onClick={onRepeat}
            >
              <RotateCcwIcon />
            </Button>
          </div>
        </div>
      </div>

      <ScenarioDesigner
        open={designerOpen}
        source={scenario}
        onOpenChange={setDesignerOpen}
        onCreated={onSelectScenario}
      />
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {scenario?.name ?? "this scenario"}?</DialogTitle>
            <DialogDescription>
              This deletes the scenario and its saved plan history. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            The grid assets, demand forecasts, events, commitments, and plan runs will be deleted.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void deleteSelectedScenario()}
              disabled={!scenario || isDeleting}
            >
              {isDeleting ? <LoaderCircleIcon className="animate-spin" /> : <Trash2Icon />}
              Delete scenario
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ScenarioMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarClockIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-2.5">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3" />
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function ScenarioDesigner({
  open,
  source,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  source?: Scenario;
  onOpenChange: (open: boolean) => void;
  onCreated: (scenarioID: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("My operating day");
  const [curve, setCurve] = useState<CurvePoint[]>(() => curveFromPreset("balanced"));
  const [supply, setSupply] = useState<SupplyPreset>("normal");
  const mutation = useMutation({
    mutationFn: async () => {
      if (!source) throw new Error("The source scenario is not available.");
      if (!name.trim()) throw new Error("Give the scenario a name.");
      return createScenario(buildCustomScenario(source, name.trim(), curve, supply));
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["scenarios"] });
      queryClient.setQueryData(["scenario", created.id], created);
      toast.success(`${created.name} is ready`);
      onOpenChange(false);
      onCreated(created.id);
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Design a scenario</DialogTitle>
          <DialogDescription>
            Wattson copies the current grid and commitments. Shape the day instead of entering 96
            forecast values.
          </DialogDescription>
        </DialogHeader>

        <label className="grid gap-1.5 text-sm font-medium">
          Scenario name
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Market day with an evening peak"
          />
        </label>

        <div>
          <p className="text-sm font-medium">Flexible demand pattern</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Drag in any direction. Add points for detail. Wattson fills the complete 24-hour
            forecast.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(demandPresets) as DemandPreset[]).map((key) => (
              <Button
                key={key}
                size="sm"
                type="button"
                variant="outline"
                onClick={() => setCurve(curveFromPreset(key))}
              >
                {key === "balanced"
                  ? "Balanced"
                  : key === "evening"
                    ? "Evening peak"
                    : "Busy daytime"}
              </Button>
            ))}
          </div>
          <CurveEditor values={curve} onChange={setCurve} />
        </div>

        <div>
          <p className="text-sm font-medium">Supply conditions</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <PresetButton
              selected={supply === "normal"}
              icon={CloudSunIcon}
              title="Expected"
              detail="Use the current supply forecast"
              onClick={() => setSupply("normal")}
            />
            <PresetButton
              selected={supply === "cloudy"}
              icon={CloudSunIcon}
              title="Cloudy noon"
              detail="Reduce midday solar output"
              onClick={() => setSupply("cloudy")}
            />
            <PresetButton
              selected={supply === "low-wind"}
              icon={WindIcon}
              title="Low wind"
              detail="Reduce wind output all day"
              onClick={() => setSupply("low-wind")}
            />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Wattson handles the setup</p>
          <p className="mt-1">
            The new scenario keeps {source?.site.assets.length ?? 0} assets,{" "}
            {source?.site.services.length ?? 0} consumers, and {source?.contracts.length ?? 0}{" "}
            commitments.
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!source || mutation.isPending || !name.trim()}
          >
            {mutation.isPending ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}
            Create scenario
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CurveEditor({
  values,
  onChange,
}: {
  values: CurvePoint[];
  onChange: (values: CurvePoint[]) => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const width = 640;
  const height = 210;
  const paddingX = 24;
  const paddingY = 20;
  const sorted = [...values].sort((left, right) => left.hour - right.hour);
  const points = sorted.map((point) => ({
    ...point,
    x: paddingX + (point.hour / 24) * (width - paddingX * 2),
    y: height - paddingY - (point.value / 100) * (height - paddingY * 2),
  }));
  const line = smoothPath(points);
  const area = `${line} L ${points.at(-1)?.x ?? width - paddingX} ${height - paddingY} L ${points[0]?.x ?? paddingX} ${height - paddingY} Z`;
  const selectedPoint = sorted.find((point) => point.id === selected);
  const selectedIndex = selectedPoint
    ? sorted.findIndex((point) => point.id === selectedPoint.id)
    : -1;
  const canRemove = selectedIndex > 0 && selectedIndex < sorted.length - 1 && sorted.length > 4;

  const changePoint = (id: string, hour: number, value: number) => {
    onChange(
      sorted
        .map((point) => (point.id === id ? { ...point, hour, value } : point))
        .sort((left, right) => left.hour - right.hour),
    );
  };

  const setFromPointer = (event: PointerEvent<SVGElement>, id: string) => {
    const svg = event.currentTarget.closest("svg");
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    const index = sorted.findIndex((point) => point.id === id);
    if (index === -1) return;
    const x = ((event.clientX - bounds.left) / bounds.width) * width;
    const y = ((event.clientY - bounds.top) / bounds.height) * height;
    const rawHour = ((x - paddingX) / (width - paddingX * 2)) * 24;
    const minimumHour = index === 0 ? 0 : sorted[index - 1].hour + 0.25;
    const maximumHour = index === sorted.length - 1 ? 24 : sorted[index + 1].hour - 0.25;
    const hour =
      index === 0
        ? 0
        : index === sorted.length - 1
          ? 24
          : roundToQuarter(clamp(rawHour, minimumHour, maximumHour));
    const value = Math.round(
      clamp(((height - paddingY - y) / (height - paddingY * 2)) * 100, 0, 100),
    );
    changePoint(id, hour, value);
  };

  const moveActive = (event: PointerEvent<SVGSVGElement>) => {
    if (active === null) return;
    setFromPointer(event, active);
  };

  const adjustWithKeyboard = (event: KeyboardEvent<SVGCircleElement>, id: string) => {
    const index = sorted.findIndex((point) => point.id === id);
    if (index === -1) return;
    if ((event.key === "Delete" || event.key === "Backspace") && canRemovePoint(id)) {
      event.preventDefault();
      removePoint(id);
      return;
    }
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const point = sorted[index];
    const minimumHour = index === 0 ? 0 : sorted[index - 1].hour + 0.25;
    const maximumHour = index === sorted.length - 1 ? 24 : sorted[index + 1].hour - 0.25;
    const hourDelta = event.key === "ArrowLeft" ? -0.25 : event.key === "ArrowRight" ? 0.25 : 0;
    const valueDelta = event.key === "ArrowUp" ? 5 : event.key === "ArrowDown" ? -5 : 0;
    changePoint(
      id,
      index === 0 || index === sorted.length - 1
        ? point.hour
        : roundToQuarter(clamp(point.hour + hourDelta, minimumHour, maximumHour)),
      clamp(point.value + valueDelta, 0, 100),
    );
  };

  const canRemovePoint = (id: string) => {
    const index = sorted.findIndex((point) => point.id === id);
    return index > 0 && index < sorted.length - 1 && sorted.length > 4;
  };

  const removePoint = (id: string) => {
    if (!canRemovePoint(id)) return;
    onChange(sorted.filter((point) => point.id !== id));
    if (selected === id) setSelected(null);
  };

  const addPoint = (hour?: number, value?: number) => {
    if (sorted.length >= 24) return;
    let nextHour = hour;
    if (nextHour === undefined) {
      let widest = { index: 0, gap: 0 };
      for (let index = 0; index < sorted.length - 1; index += 1) {
        const gap = sorted[index + 1].hour - sorted[index].hour;
        if (gap > widest.gap) widest = { index, gap };
      }
      nextHour = roundToQuarter((sorted[widest.index].hour + sorted[widest.index + 1].hour) / 2);
    }
    nextHour = clamp(roundToQuarter(nextHour), 0.25, 23.75);
    if (sorted.some((point) => Math.abs(point.hour - nextHour) < 0.24)) return;
    const point: CurvePoint = {
      id: `curve-${Date.now().toString(36)}-${Math.round(nextHour * 100)}`,
      hour: nextHour,
      value: clamp(Math.round(value ?? interpolateCurveAtHour(sorted, nextHour)), 0, 100),
    };
    onChange([...sorted, point].sort((left, right) => left.hour - right.hour));
    setSelected(point.id);
  };

  const addFromChart = (event: MouseEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * width;
    const y = ((event.clientY - bounds.top) / bounds.height) * height;
    const hour = ((x - paddingX) / (width - paddingX * 2)) * 24;
    const value = ((height - paddingY - y) / (height - paddingY * 2)) * 100;
    addPoint(hour, value);
  };

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border bg-background">
      <div className="border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium">24-hour demand curve</p>
            <p className="text-[10px] text-muted-foreground">
              Drag points. Double-click the chart to add one.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-[10px] tabular-nums text-muted-foreground">
              {sorted.length} points
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => addPoint()}
              disabled={sorted.length >= 24}
            >
              <PlusIcon /> Add point
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Remove selected curve point"
              onClick={() => selected && removePoint(selected)}
              disabled={!canRemove}
            >
              <MinusIcon />
            </Button>
          </div>
        </div>
      </div>
      <div className="p-2">
        <svg
          className="h-52 w-full touch-none select-none"
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label="Demand curve"
          onDoubleClick={addFromChart}
          onPointerMove={moveActive}
          onPointerUp={() => setActive(null)}
          onPointerCancel={() => setActive(null)}
        >
          {[0, 25, 50, 75, 100].map((value) => {
            const y = height - paddingY - (value / 100) * (height - paddingY * 2);
            return (
              <g key={value}>
                <line
                  x1={paddingX}
                  x2={width - paddingX}
                  y1={y}
                  y2={y}
                  stroke="var(--border)"
                  strokeDasharray="3 5"
                />
                <text x={paddingX} y={y - 4} fill="var(--muted-foreground)" fontSize="9">
                  {value}%
                </text>
              </g>
            );
          })}
          {[0, 6, 12, 18, 24].map((hour) => {
            const x = paddingX + (hour / 24) * (width - paddingX * 2);
            return (
              <line
                key={hour}
                x1={x}
                x2={x}
                y1={paddingY}
                y2={height - paddingY}
                stroke="var(--border)"
                strokeDasharray="3 5"
              />
            );
          })}
          <path d={area} fill="color-mix(in oklch, var(--primary) 14%, transparent)" />
          <path
            d={line}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          {points.map((point) => (
            <circle
              key={point.id}
              cx={point.x}
              cy={point.y}
              r={selected === point.id ? 9 : 7}
              fill={selected === point.id ? "var(--primary)" : "var(--background)"}
              stroke="var(--primary)"
              strokeWidth="3"
              role="slider"
              tabIndex={0}
              aria-label={`${formatHour(point.hour)} demand`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={point.value}
              onDoubleClick={(event) => event.stopPropagation()}
              onFocus={() => setSelected(point.id)}
              onKeyDown={(event) => adjustWithKeyboard(event, point.id)}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                setActive(point.id);
                setSelected(point.id);
                setFromPointer(event, point.id);
              }}
            />
          ))}
        </svg>
        <div className="flex justify-between px-4 text-[10px] text-muted-foreground">
          <span>12 AM</span>
          <span>6 AM</span>
          <span>Noon</span>
          <span>6 PM</span>
          <span>12 AM</span>
        </div>
      </div>
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-3 py-2">
        {selectedPoint ? (
          <>
            <p className="text-xs">
              <span className="font-medium">Selected point</span>
              <span className="ml-2 text-muted-foreground">
                {formatHour(selectedPoint.hour)} · {selectedPoint.value}% demand
              </span>
            </p>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                Time
                <Input
                  className="h-8 w-20 bg-background text-xs"
                  type="number"
                  min={selectedIndex <= 0 ? 0 : sorted[selectedIndex - 1].hour + 0.25}
                  max={
                    selectedIndex === sorted.length - 1 ? 24 : sorted[selectedIndex + 1].hour - 0.25
                  }
                  step="0.25"
                  disabled={selectedIndex === 0 || selectedIndex === sorted.length - 1}
                  value={selectedPoint.hour}
                  onChange={(event) =>
                    changePoint(
                      selectedPoint.id,
                      selectedIndex === 0 || selectedIndex === sorted.length - 1
                        ? selectedPoint.hour
                        : roundToQuarter(
                            clamp(
                              Number(event.target.value),
                              sorted[selectedIndex - 1].hour + 0.25,
                              sorted[selectedIndex + 1].hour - 0.25,
                            ),
                          ),
                      selectedPoint.value,
                    )
                  }
                />
              </label>
              <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                Demand
                <Input
                  className="h-8 w-20 bg-background text-xs"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={selectedPoint.value}
                  onChange={(event) =>
                    changePoint(
                      selectedPoint.id,
                      selectedPoint.hour,
                      clamp(Number(event.target.value), 0, 100),
                    )
                  }
                />
              </label>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Select a point to edit its exact time and demand.
          </p>
        )}
      </div>
    </div>
  );
}

function PresetButton({
  selected,
  icon: Icon,
  title,
  detail,
  onClick,
}: {
  selected: boolean;
  icon: typeof CloudSunIcon;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rounded-lg border p-3 text-left transition-colors ${selected ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-muted/50"}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <Icon className={selected ? "text-primary" : "text-muted-foreground"} />
      <span className="mt-2 block text-sm font-medium">{title}</span>
      <span className="mt-0.5 block text-[11px] text-muted-foreground">{detail}</span>
    </button>
  );
}

function buildCustomScenario(
  source: Scenario,
  name: string,
  curve: CurvePoint[],
  supply: SupplyPreset,
): Scenario {
  const scenario = structuredClone(source);
  const suffix = Date.now().toString(36);
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 36) || "scenario";
  scenario.id = `${slug}-${suffix}`;
  scenario.site.id = `${slug}-site-${suffix}`;
  scenario.name = name;
  scenario.site.name = name;
  scenario.description = `Custom operating day based on ${source.name}.`;
  scenario.revision = 1;
  scenario.events = [];

  for (const signal of scenario.signals) {
    if (signal.kind === "service_demand" && signal.service_id) {
      const service = scenario.site.services.find((item) => item.id === signal.service_id);
      if (!service || service.control_mode !== "curtailable") continue;
      signal.values = Array.from({ length: scenario.horizon.interval_count }, (_, index) =>
        round(
          (interpolateCurveAtHour(
            curve,
            (index / Math.max(1, scenario.horizon.interval_count - 1)) * 24,
          ) /
            100) *
            service.rated_power_kw,
        ),
      );
    }
    if (signal.kind === "renewable_availability") {
      const asset = scenario.site.assets.find((item) => item.id === signal.asset_id);
      if (supply === "low-wind" && asset?.type === "wind") {
        signal.values = signal.values.map((value) => round(value * 0.35));
      }
      if (supply === "cloudy" && asset?.type === "solar") {
        signal.values = signal.values.map((value, index) => {
          const hour = (index * scenario.horizon.interval_minutes) / 60;
          const multiplier = hour >= 10 && hour <= 15 ? 0.45 : 0.85;
          return round(value * multiplier);
        });
      }
    }
  }
  return scenario;
}

function curveFromPreset(preset: DemandPreset): CurvePoint[] {
  const values = demandPresets[preset];
  return values.map((value, index) => ({
    id: `${preset}-${index}`,
    hour: (index / (values.length - 1)) * 24,
    value,
  }));
}

function interpolateCurveAtHour(points: CurvePoint[], hour: number) {
  const sorted = [...points].sort((left, right) => left.hour - right.hour);
  if (hour <= sorted[0].hour) return sorted[0].value;
  if (hour >= sorted.at(-1)!.hour) return sorted.at(-1)!.value;
  const rightIndex = sorted.findIndex((point) => point.hour >= hour);
  const left = sorted[rightIndex - 1];
  const right = sorted[rightIndex];
  const amount = (hour - left.hour) / Math.max(0.01, right.hour - left.hour);
  return left.value * (1 - amount) + right.value * amount;
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return "";
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const middle = (previous.x + point.x) / 2;
    return `${path} C ${middle} ${previous.y}, ${middle} ${point.y}, ${point.x} ${point.y}`;
  }, `M ${points[0].x} ${points[0].y}`);
}

function formatHour(hour: number) {
  if (hour === 24) return "12:00 AM";
  const totalMinutes = Math.round(hour * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${minutes.toString().padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

function roundToQuarter(value: number) {
  return Math.round(value * 4) / 4;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
