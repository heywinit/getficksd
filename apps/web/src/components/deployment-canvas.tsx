import { Button } from "@getficksd/ui/components/button";
import {
  BatteryChargingIcon,
  CrossIcon,
  DropletsIcon,
  FuelIcon,
  GaugeIcon,
  Grid2X2Icon,
  HomeIcon,
  LocateFixedIcon,
  MinusIcon,
  PlusIcon,
  RotateCcwIcon,
  SunIcon,
  WindIcon,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import { operatingStateAt, TimeRail } from "@/components/time-rail";
import type { PlanRun, Scenario } from "@/lib/plan-run";

const GRID_SIZE = 16;
const WORLD_WIDTH = 1480;
const WORLD_HEIGHT = 688;
const MIN_SCALE = 0.3;
const MAX_SCALE = 2;
const UNIT_SIZE = 40;

export type CanvasView = "activity" | "architecture" | "forecast";

type CanvasNode = {
  id: string;
  title: string;
  detail: string;
  metric: string;
  status: string;
  icon: LucideIcon;
  iconClassName: string;
  dimmed?: boolean;
  statusTone?: "active" | "normal" | "warning";
  width: number;
  height: number;
  x: number;
  y: number;
};

type CanvasTransform = {
  x: number;
  y: number;
  scale: number;
};

type DragState =
  | {
      type: "canvas";
      pointerId: number;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    }
  | {
      type: "node";
      pointerId: number;
      nodeId: string;
      offsetX: number;
      offsetY: number;
      startX: number;
      startY: number;
      moved: boolean;
    };

type SourceUnit = {
  id: string;
  parentId: "solar" | "wind";
  number: number;
  side: "bottom" | "left" | "right" | "top";
  size: number;
  x: number;
  y: number;
};

const sourceUnitCounts = {
  solar: 6,
  wind: 4,
} as const;

const initialNodes: CanvasNode[] = [
  {
    id: "solar",
    title: "Community solar",
    detail: "Renewable supply",
    metric: "120 kW available",
    status: "Forecast online",
    icon: SunIcon,
    iconClassName: "bg-chart-1/15 text-chart-1",
    width: 280,
    height: 184,
    x: 64,
    y: 64,
  },
  {
    id: "wind",
    title: "Ridge wind",
    detail: "Renewable supply",
    metric: "35 kW available",
    status: "Forecast online",
    icon: WindIcon,
    iconClassName: "bg-chart-2/15 text-chart-2",
    width: 232,
    height: 140,
    x: 96,
    y: 336,
  },
  {
    id: "battery",
    title: "Community battery",
    detail: "Energy storage",
    metric: "234 / 360 kWh",
    status: "65% charged",
    icon: BatteryChargingIcon,
    iconClassName: "bg-chart-3/15 text-chart-3",
    width: 292,
    height: 164,
    x: 408,
    y: 136,
  },
  {
    id: "diesel",
    title: "Diesel backup",
    detail: "Dispatchable supply",
    metric: "80 kW capacity",
    status: "Standby",
    icon: FuelIcon,
    iconClassName: "bg-chart-4/15 text-chart-4",
    width: 296,
    height: 184,
    x: 432,
    y: 432,
  },
  {
    id: "controller",
    title: "Grid controller",
    detail: "Spiti Valley",
    metric: "Peak demand 142 kW",
    status: "Operating normally",
    icon: GaugeIcon,
    iconClassName: "bg-chart-5/15 text-chart-5",
    width: 304,
    height: 192,
    x: 776,
    y: 240,
  },
  {
    id: "clinic",
    title: "Clinic cold chain",
    detail: "Fixed service",
    metric: "0.8 kW protected",
    status: "Critical load",
    icon: CrossIcon,
    iconClassName: "bg-destructive/15 text-destructive",
    width: 224,
    height: 136,
    x: 1200,
    y: 56,
  },
  {
    id: "water",
    title: "Water supply",
    detail: "Shiftable service",
    metric: "8 kW scheduled",
    status: "Tank on target",
    icon: DropletsIcon,
    iconClassName: "bg-chart-2/15 text-chart-2",
    width: 252,
    height: 152,
    x: 1168,
    y: 264,
  },
  {
    id: "homes",
    title: "Flexible homes",
    detail: "Curtailable service",
    metric: "85 kW available",
    status: "Within comfort band",
    icon: HomeIcon,
    iconClassName: "bg-chart-5/15 text-chart-5",
    width: 280,
    height: 176,
    x: 1152,
    y: 480,
  },
];

const connections = [
  ["solar", "battery"],
  ["wind", "battery"],
  ["battery", "controller"],
  ["diesel", "controller"],
  ["controller", "clinic"],
  ["controller", "water"],
  ["controller", "homes"],
] as const;

export function DeploymentCanvas({
  view = "architecture",
  scenario,
  run,
}: {
  view?: CanvasView;
  scenario?: Scenario;
  run?: PlanRun;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState(initialNodes);
  const [transform, setTransform] = useState<CanvasTransform>({ x: 32, y: 24, scale: 0.9 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>("controller");
  const [expandedSources, setExpandedSources] = useState<Set<string>>(() => new Set());
  const [currentHour, setCurrentHour] = useState(10.5);
  const [isPlaying, setIsPlaying] = useState(true);

  const fitView = useCallback(() => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;

    const availableHeight = Math.max(280, bounds.height - 112);
    const scale = clamp(
      Math.min((bounds.width - 96) / WORLD_WIDTH, (availableHeight - 64) / WORLD_HEIGHT),
      MIN_SCALE,
      1,
    );

    setTransform({
      scale,
      x: bounds.width < 768 ? 24 : Math.round((bounds.width - WORLD_WIDTH * scale) / 2),
      y: Math.max(24, Math.round((availableHeight - WORLD_HEIGHT * scale) / 2)),
    });
  }, []);

  useEffect(() => {
    fitView();
    const observer = new ResizeObserver(fitView);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [fitView]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (event: WheelEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-time-rail]")) return;
      event.preventDefault();

      if (event.ctrlKey || event.metaKey) {
        const bounds = canvas.getBoundingClientRect();
        const pointerX = event.clientX - bounds.left;
        const pointerY = event.clientY - bounds.top;
        const zoomFactor = Math.exp(-event.deltaY * 0.008);

        setTransform((current) => {
          const scale = clamp(current.scale * zoomFactor, MIN_SCALE, MAX_SCALE);
          return {
            scale,
            x: pointerX - ((pointerX - current.x) / current.scale) * scale,
            y: pointerY - ((pointerY - current.y) / current.scale) * scale,
          };
        });
        return;
      }

      setTransform((current) => ({
        ...current,
        x: current.x - event.deltaX,
        y: current.y - event.deltaY,
      }));
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setCurrentHour((hour) => (hour >= 24 ? 0 : hour + 1 / 60));
    }, 100);
    return () => window.clearInterval(timer);
  }, [isPlaying]);

  const operatingState = useMemo(
    () => operatingStateAt(currentHour, scenario, run),
    [currentHour, run, scenario],
  );
  const sceneNodes = useMemo(
    () =>
      nodes.map((node) =>
        applyCanvasView(
          applyOperatingState(applyScenarioMetadata(node, scenario), operatingState),
          view,
        ),
      ),
    [nodes, operatingState, scenario, view],
  );
  const nodeLookup = useMemo(
    () => new Map(sceneNodes.map((node) => [node.id, node])),
    [sceneNodes],
  );
  const sourceUnits = useMemo(
    () =>
      sceneNodes.flatMap((node) =>
        isExpandableSource(node.id) && expandedSources.has(node.id)
          ? createSourceUnits(node, sourceUnitCounts[node.id])
          : [],
      ),
    [expandedSources, sceneNodes],
  );

  const startCanvasDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    canvasRef.current?.setPointerCapture(event.pointerId);
    setSelectedNode(null);
    setDrag({
      type: "canvas",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y,
    });
  };

  const startNodeDrag = (event: PointerEvent<HTMLElement>, node: CanvasNode) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;

    canvasRef.current?.setPointerCapture(event.pointerId);
    const pointerX = (event.clientX - bounds.left - transform.x) / transform.scale;
    const pointerY = (event.clientY - bounds.top - transform.y) / transform.scale;
    setSelectedNode(node.id);
    setDrag({
      type: "node",
      pointerId: event.pointerId,
      nodeId: node.id,
      offsetX: pointerX - node.x,
      offsetY: pointerY - node.y,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    });
  };

  const continueDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (drag.type === "canvas") {
      setTransform((current) => ({
        ...current,
        x: drag.originX + event.clientX - drag.startX,
        y: drag.originY + event.clientY - drag.startY,
      }));
      return;
    }

    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const pointerX = (event.clientX - bounds.left - transform.x) / transform.scale;
    const pointerY = (event.clientY - bounds.top - transform.y) / transform.scale;
    const moved =
      drag.moved || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5;
    const x = snap(pointerX - drag.offsetX);
    const y = snap(pointerY - drag.offsetY);

    if (moved !== drag.moved) {
      setDrag({ ...drag, moved });
    }

    setNodes((current) =>
      current.map((node) => (node.id === drag.nodeId ? { ...node, x, y } : node)),
    );
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (canvasRef.current?.hasPointerCapture(event.pointerId)) {
      canvasRef.current.releasePointerCapture(event.pointerId);
    }
    const nodeMoved =
      drag.type === "node" &&
      (drag.moved || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5);
    if (drag.type === "node" && !nodeMoved && isExpandableSource(drag.nodeId)) {
      toggleSource(drag.nodeId);
    }
    setDrag(null);
  };

  const toggleSource = (nodeId: string) => {
    if (!isExpandableSource(nodeId)) return;
    setExpandedSources((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const changeZoom = (nextScale: number) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    const centerX = bounds.width / 2;
    const centerY = bounds.height / 2;

    setTransform((current) => ({
      scale,
      x: centerX - ((centerX - current.x) / current.scale) * scale,
      y: centerY - ((centerY - current.y) / current.scale) * scale,
    }));
  };

  const resetLayout = () => {
    setNodes(initialNodes);
    setSelectedNode("controller");
    setExpandedSources(new Set());
    fitView();
  };

  return (
    <div
      ref={canvasRef}
      className={`relative min-h-0 flex-1 touch-none overflow-hidden bg-background select-none ${drag?.type === "canvas" ? "cursor-grabbing" : "cursor-grab"}`}
      style={{
        backgroundImage:
          "radial-gradient(circle, color-mix(in oklch, var(--muted-foreground) 24%, transparent) 1px, transparent 1.2px)",
        backgroundPosition: `${transform.x}px ${transform.y}px`,
        backgroundSize: `${GRID_SIZE * transform.scale}px ${GRID_SIZE * transform.scale}px`,
      }}
      onPointerDown={startCanvasDrag}
      onPointerMove={continueDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          width: WORLD_WIDTH,
          height: WORLD_HEIGHT,
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: "0 0",
        }}
      >
        <svg
          className="pointer-events-none absolute inset-0 overflow-visible"
          width={WORLD_WIDTH}
          height={WORLD_HEIGHT}
          aria-hidden="true"
        >
          <defs>
            <marker
              id="canvas-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--muted-foreground)" fillOpacity="0.8" />
            </marker>
          </defs>
          {connections.map(([fromId, toId]) => {
            const from = nodeLookup.get(fromId);
            const to = nodeLookup.get(toId);
            if (!from || !to) return null;
            const emphasized = connectionIsEmphasized(fromId, toId, view);
            const dieselActive = fromId === "diesel" && operatingState.dieselOn;
            return (
              <path
                key={`${fromId}-${toId}`}
                d={connectionPath(from, to)}
                fill="none"
                stroke={dieselActive ? "var(--chart-4)" : "var(--muted-foreground)"}
                strokeOpacity={emphasized ? (dieselActive ? 1 : 0.7) : 0.12}
                strokeWidth="1.5"
                strokeDasharray={dieselActive ? undefined : "5 5"}
                markerEnd="url(#canvas-arrow)"
              />
            );
          })}
          {sourceUnits.map((unit) => {
            const parent = nodeLookup.get(unit.parentId);
            if (!parent) return null;
            return (
              <path
                key={`${unit.id}-connection`}
                d={unitConnectionPath(parent, unit)}
                fill="none"
                stroke={accentForNode(unit.parentId)}
                strokeOpacity="0.48"
                strokeWidth="1.25"
              />
            );
          })}
        </svg>

        {sourceUnits.map((unit) => (
          <SourceUnitCard key={unit.id} unit={unit} />
        ))}

        {sceneNodes.map((node) => (
          <ServiceCard
            key={node.id}
            node={node}
            selected={selectedNode === node.id}
            expanded={expandedSources.has(node.id)}
            dieselLitres={operatingState.dieselFuelLiters}
            onToggle={() => toggleSource(node.id)}
            onPointerDown={(event) => startNodeDrag(event, node)}
          />
        ))}
      </div>

      <div className="absolute left-4 top-4 flex flex-col gap-2">
        <div className="rounded-lg border border-border bg-popover/95 p-1 shadow-2xl backdrop-blur">
          <Button
            size="icon"
            variant="ghost"
            className="text-muted-foreground"
            aria-label="Canvas tool"
          >
            <Grid2X2Icon />
          </Button>
        </div>
        <div className="flex flex-col rounded-lg border border-border bg-popover/95 p-1 shadow-2xl backdrop-blur">
          <Button
            size="icon"
            variant="ghost"
            className="text-muted-foreground"
            aria-label="Zoom in"
            onClick={() => changeZoom(transform.scale + 0.1)}
          >
            <PlusIcon />
          </Button>
          <span className="mx-1 border-t border-border" />
          <Button
            size="icon"
            variant="ghost"
            className="text-muted-foreground"
            aria-label="Zoom out"
            onClick={() => changeZoom(transform.scale - 0.1)}
          >
            <MinusIcon />
          </Button>
          <span className="mx-1 border-t border-border" />
          <Button
            size="icon"
            variant="ghost"
            className="text-muted-foreground"
            aria-label="Fit canvas"
            onClick={fitView}
          >
            <LocateFixedIcon />
          </Button>
        </div>
        <div className="rounded-lg border border-border bg-popover/95 p-1 shadow-2xl backdrop-blur">
          <Button
            size="icon"
            variant="ghost"
            className="text-muted-foreground"
            aria-label="Reset layout"
            onClick={resetLayout}
          >
            <RotateCcwIcon />
          </Button>
        </div>
      </div>

      <TimeRail
        currentHour={currentHour}
        isPlaying={isPlaying}
        run={run}
        scenario={scenario}
        onCurrentHourChange={setCurrentHour}
        onPlayingChange={setIsPlaying}
      />
    </div>
  );
}

function ServiceCard({
  node,
  selected,
  expanded,
  dieselLitres,
  onToggle,
  onPointerDown,
}: {
  node: CanvasNode;
  selected: boolean;
  expanded: boolean;
  dieselLitres: number;
  onToggle: () => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
}) {
  const Icon = node.icon;
  const metric = metricParts(node);
  const accent = accentForNode(node.id);
  const compact = node.height <= 144;
  const spacious = node.height >= 176;
  const unitCount = isExpandableSource(node.id) ? sourceUnitCounts[node.id] : null;
  const radius =
    node.id === "solar"
      ? "rounded-[28px]"
      : node.id === "controller"
        ? "rounded-[24px]"
        : compact
          ? "rounded-[18px]"
          : "rounded-[22px]";

  return (
    <article
      className={`group absolute flex cursor-grab flex-col overflow-hidden border border-border bg-card text-left outline-none transition-[box-shadow,opacity,transform] active:cursor-grabbing ${radius} ${selected ? "ring-1 ring-foreground/20" : "hover:-translate-y-0.5"} ${node.dimmed ? "opacity-50" : "opacity-100"}`}
      style={{
        width: node.width,
        height: node.height,
        left: node.x,
        top: node.y,
        boxShadow: selected
          ? "inset 0 1px 0 color-mix(in oklch, var(--foreground) 11%, transparent), 0 24px 54px -24px color-mix(in oklch, var(--foreground) 32%, transparent), 0 10px 22px -14px color-mix(in oklch, var(--foreground) 24%, transparent)"
          : "inset 0 1px 0 color-mix(in oklch, var(--foreground) 9%, transparent), 0 18px 42px -22px color-mix(in oklch, var(--foreground) 28%, transparent), 0 8px 18px -13px color-mix(in oklch, var(--foreground) 20%, transparent)",
      }}
      aria-expanded={unitCount === null ? undefined : expanded}
      aria-label={unitCount === null ? undefined : `${node.title}, ${unitCount} units`}
      role={unitCount === null ? undefined : "button"}
      tabIndex={unitCount === null ? undefined : 0}
      onKeyDown={(event) => {
        if (unitCount !== null && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onToggle();
        }
      }}
      onPointerDown={onPointerDown}
    >
      <span
        className="pointer-events-none absolute inset-x-5 top-0 h-px"
        style={{
          background: `linear-gradient(90deg, transparent, color-mix(in oklch, ${accent} 46%, transparent), transparent)`,
        }}
      />
      <span className={`flex shrink-0 items-center gap-2.5 ${compact ? "px-3 pt-3" : "px-4 pt-4"}`}>
        <span
          className={`grid shrink-0 place-items-center rounded-full ${compact ? "size-9" : "size-10"} ${node.iconClassName}`}
        >
          <Icon className={compact ? "size-4" : "size-5"} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-card-foreground">
            {node.title}
          </span>
          <span className="block truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {node.detail}
          </span>
        </span>
        {unitCount !== null ? (
          <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-1 font-mono text-[9px] text-muted-foreground">
            {expanded ? "Hide" : `${unitCount} units`}
          </span>
        ) : null}
      </span>

      <span className={`relative block min-h-0 flex-1 ${compact ? "px-3 pt-1.5" : "px-4 pt-3"}`}>
        <span className="relative z-10 flex items-baseline gap-1.5">
          <span
            className={`${spacious ? "text-[30px]" : "text-2xl"} font-medium tracking-[-0.04em] text-card-foreground`}
          >
            {metric.value}
          </span>
          <span className="max-w-24 truncate text-[10px] text-muted-foreground">{metric.unit}</span>
        </span>
        {node.id === "diesel" ? (
          <DieselIntake litres={dieselLitres} status={node.status} statusTone={node.statusTone} />
        ) : (
          <>
            <NodeVisual node={node} accent={accent} />
            <StatusPill node={node} accent={accent} compact={compact} />
          </>
        )}
      </span>
    </article>
  );
}

function SourceUnitCard({ unit }: { unit: SourceUnit }) {
  const isSolar = unit.parentId === "solar";
  const Icon = isSolar ? SunIcon : WindIcon;
  const accent = accentForNode(unit.parentId);

  return (
    <div
      className={`absolute grid animate-in place-items-center rounded-xl border fade-in zoom-in-95 duration-200 ${isSolar ? "border-chart-1 bg-chart-1" : "border-chart-2 bg-chart-2"}`}
      style={{
        width: unit.size,
        height: unit.size,
        left: unit.x,
        top: unit.y,
        color: "var(--foreground)",
        boxShadow: `inset 0 1px 0 color-mix(in oklch, var(--background) 30%, transparent), 0 12px 24px -12px color-mix(in oklch, ${accent} 48%, transparent)`,
      }}
      title={`${isSolar ? "Solar panel" : "Wind turbine"} ${unit.number}`}
    >
      <Icon className="absolute size-6 opacity-20" />
      <span className="relative font-mono text-[11px] font-semibold">
        {String(unit.number).padStart(2, "0")}
      </span>
    </div>
  );
}

function StatusPill({
  node,
  accent,
  compact,
}: {
  node: CanvasNode;
  accent: string;
  compact: boolean;
}) {
  return (
    <span
      className={`absolute z-10 flex max-w-[172px] items-center gap-1.5 truncate rounded-full bg-muted px-2 py-1 text-[9px] ${compact ? "bottom-2.5 left-3" : "bottom-3 left-4"} ${node.statusTone === "warning" ? "text-destructive" : "text-muted-foreground"}`}
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: node.statusTone === "warning" ? "var(--destructive)" : accent }}
      />
      <span className="truncate">{node.status}</span>
    </span>
  );
}

function DieselIntake({
  litres,
  status,
  statusTone,
}: {
  litres: number;
  status: string;
  statusTone?: CanvasNode["statusTone"];
}) {
  return (
    <span className="absolute inset-x-4 bottom-3 z-20 flex items-end justify-between gap-2">
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
          <span
            className={`size-1.5 rounded-full ${statusTone === "active" ? "bg-chart-4" : "bg-muted-foreground"}`}
          />
          {status}
        </span>
        <span className="mt-1 block font-mono text-[11px] text-chart-4" aria-live="polite">
          {litres.toLocaleString()} L stored
        </span>
      </span>
      <span className="rounded-md border border-border bg-muted px-2 py-1.5 text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
        Planner record
      </span>
    </span>
  );
}

function NodeVisual({ node, accent }: { node: CanvasNode; accent: string }) {
  if (node.id === "battery") {
    const percent = Number.parseInt(node.status, 10) || 0;
    return (
      <span className="absolute bottom-3 right-3 grid w-20 gap-1">
        <span className="text-right font-mono text-[9px] text-muted-foreground">RESERVE</span>
        <span className="h-2 overflow-hidden rounded-full bg-muted">
          <span className="block h-full rounded-full bg-chart-3" style={{ width: `${percent}%` }} />
        </span>
      </span>
    );
  }

  if (node.id === "diesel") {
    const active = node.statusTone === "active";
    return (
      <span className="absolute bottom-3 right-3 flex items-end gap-1">
        {[0.35, 0.5, 0.7, 0.55, 0.85].map((height, index) => (
          <span
            key={height}
            className={`w-2 rounded-sm ${active && index < 4 ? "bg-chart-4" : "bg-chart-4/20"}`}
            style={{ height: 8 + height * 22 }}
          />
        ))}
      </span>
    );
  }

  if (node.id === "water") {
    return (
      <span className="absolute bottom-3 right-3 grid w-16 gap-1">
        <span className="font-mono text-[9px] text-chart-2">06:00</span>
        <span className="flex gap-1">
          <span className="h-1.5 flex-1 rounded-full bg-chart-2" />
          <span className="h-1.5 flex-1 rounded-full bg-chart-2" />
          <span className="h-1.5 flex-1 rounded-full bg-chart-2/20" />
        </span>
      </span>
    );
  }

  if (node.id === "clinic") {
    return (
      <span className="absolute bottom-3 right-3 grid size-10 place-items-center rounded-full border border-destructive/30 bg-destructive/10 text-sm font-medium text-destructive">
        24h
      </span>
    );
  }

  const paths: Record<string, string> = {
    solar: "M0 42 C14 42 18 35 28 30 C40 23 50 7 65 9 C79 11 82 30 100 34 L100 48 L0 48 Z",
    wind: "M0 35 C14 20 28 43 43 27 C59 10 72 37 100 16 L100 48 L0 48 Z",
    controller: "M0 38 C17 37 26 22 39 25 C55 30 64 18 75 20 C85 22 89 10 100 13 L100 48 L0 48 Z",
    homes: "M0 39 C16 34 27 16 43 23 C61 32 68 37 77 24 C87 9 93 18 100 6 L100 48 L0 48 Z",
  };
  const path = paths[node.id];
  if (!path) return null;

  return (
    <svg
      className="absolute bottom-0 right-0 h-14 w-28 opacity-45"
      viewBox="0 0 100 48"
      aria-hidden="true"
      style={{ color: accent }}
    >
      <path d={path} fill="currentColor" fillOpacity="0.22" />
      <path d={path.replace(" L100 48 L0 48 Z", "")} fill="none" stroke="currentColor" />
    </svg>
  );
}

function metricParts(node: CanvasNode) {
  if (node.id === "controller") {
    const match = node.metric.match(/Demand (\d+) kW/);
    return { value: match?.[1] ?? node.metric, unit: match ? "kW demand" : "" };
  }

  const match = node.metric.match(/^([\d.]+)\s*(.*)$/);
  return { value: match?.[1] ?? node.metric, unit: match?.[2] ?? "" };
}

function accentForNode(nodeId: string) {
  const colors: Record<string, string> = {
    solar: "var(--chart-1)",
    wind: "var(--chart-2)",
    battery: "var(--chart-3)",
    diesel: "var(--chart-4)",
    controller: "var(--chart-5)",
    clinic: "var(--destructive)",
    water: "var(--chart-2)",
    homes: "var(--chart-5)",
  };
  return colors[nodeId] ?? "var(--primary)";
}

function connectionPath(from: CanvasNode, to: CanvasNode) {
  const fromCenterX = from.x + from.width / 2;
  const fromCenterY = from.y + from.height / 2;
  const toCenterX = to.x + to.width / 2;
  const toCenterY = to.y + to.height / 2;
  const deltaX = toCenterX - fromCenterX;
  const deltaY = toCenterY - fromCenterY;

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    const startX = deltaX >= 0 ? from.x + from.width : from.x;
    const endX = deltaX >= 0 ? to.x : to.x + to.width;
    const direction = deltaX >= 0 ? 1 : -1;
    const bend = Math.max(56, Math.abs(endX - startX) * 0.45) * direction;
    return `M ${startX} ${fromCenterY} C ${startX + bend} ${fromCenterY}, ${endX - bend} ${toCenterY}, ${endX} ${toCenterY}`;
  }

  const startY = deltaY >= 0 ? from.y + from.height : from.y;
  const endY = deltaY >= 0 ? to.y : to.y + to.height;
  const direction = deltaY >= 0 ? 1 : -1;
  const bend = Math.max(56, Math.abs(endY - startY) * 0.45) * direction;
  return `M ${fromCenterX} ${startY} C ${fromCenterX} ${startY + bend}, ${toCenterX} ${endY - bend}, ${toCenterX} ${endY}`;
}

function isExpandableSource(nodeId: string): nodeId is keyof typeof sourceUnitCounts {
  return nodeId === "solar" || nodeId === "wind";
}

function createSourceUnits(parent: CanvasNode, count: number): SourceUnit[] {
  const parentId = parent.id as SourceUnit["parentId"];

  if (parentId === "solar") {
    const rowCount = count / 2;
    const gap = 32;
    const rowWidth = rowCount * UNIT_SIZE + (rowCount - 1) * gap;
    const startX = parent.x + (parent.width - rowWidth) / 2;

    return Array.from({ length: count }, (_, index) => {
      const side = index < rowCount ? "top" : "bottom";
      const rowIndex = index % rowCount;
      return {
        id: `${parentId}-unit-${index + 1}`,
        parentId,
        number: index + 1,
        side,
        size: UNIT_SIZE,
        x: startX + rowIndex * (UNIT_SIZE + gap),
        y: side === "top" ? parent.y - UNIT_SIZE - 28 : parent.y + parent.height + 28,
      };
    });
  }

  const edgeCount = count / 2;
  const gap = 24;
  const bottomGap = 32;
  const bottomWidth = edgeCount * UNIT_SIZE + (edgeCount - 1) * bottomGap;
  const bottomStartX = parent.x + (parent.width - bottomWidth) / 2;
  const columnHeight = edgeCount * UNIT_SIZE + (edgeCount - 1) * gap;
  const startY = parent.y + (parent.height - columnHeight) / 2;

  return Array.from({ length: count }, (_, index) => {
    const side = index < edgeCount ? "left" : "bottom";
    const edgeIndex = index % edgeCount;
    return {
      id: `${parentId}-unit-${index + 1}`,
      parentId,
      number: index + 1,
      side,
      size: UNIT_SIZE,
      x:
        side === "left"
          ? parent.x - UNIT_SIZE - 28
          : bottomStartX + edgeIndex * (UNIT_SIZE + bottomGap),
      y: side === "left" ? startY + edgeIndex * (UNIT_SIZE + gap) : parent.y + parent.height + 28,
    };
  });
}

function unitConnectionPath(parent: CanvasNode, unit: SourceUnit) {
  if (unit.side === "top") {
    const x = unit.x + unit.size / 2;
    return `M ${x} ${unit.y + unit.size} L ${x} ${parent.y}`;
  }
  if (unit.side === "bottom") {
    const x = unit.x + unit.size / 2;
    return `M ${x} ${unit.y} L ${x} ${parent.y + parent.height}`;
  }
  if (unit.side === "left") {
    const y = unit.y + unit.size / 2;
    return `M ${unit.x + unit.size} ${y} L ${parent.x} ${y}`;
  }

  const y = unit.y + unit.size / 2;
  return `M ${unit.x} ${y} L ${parent.x + parent.width} ${y}`;
}

function applyOperatingState(
  node: CanvasNode,
  state: ReturnType<typeof operatingStateAt>,
): CanvasNode {
  switch (node.id) {
    case "solar":
      return {
        ...node,
        metric: `${state.solarKw} kW producing`,
        status: state.solarKw < 4 ? "Sun below horizon" : "Forecast online",
        dimmed: state.solarKw < 4,
      };
    case "wind":
      return { ...node, metric: `${state.windKw} kW producing` };
    case "battery":
      return {
        ...node,
        metric: `${state.batteryEnergyKwh} / ${state.batteryCapacityKwh} kWh`,
        status: `${state.batteryPercent}% charged`,
        statusTone: state.batteryPercent < 25 ? "warning" : "normal",
      };
    case "diesel":
      return {
        ...node,
        metric: state.dieselOn
          ? `${state.dieselOutputKw} kW output`
          : `${state.dieselCapacityKw} kW capacity`,
        status: state.dieselOn ? "Generator running" : "Standby",
        statusTone: state.dieselOn ? "active" : "normal",
        dimmed: false,
      };
    case "controller":
      return {
        ...node,
        metric: `Demand ${state.demandKw} kW`,
        status: state.contractAtRisk
          ? "A commitment needs attention"
          : state.dieselOn
            ? "Dispatching backup generation"
            : "All commitments protected",
        statusTone: state.contractAtRisk ? "warning" : state.dieselOn ? "active" : "normal",
      };
    case "clinic":
      return {
        ...node,
        metric: `${state.clinicDeliveredKw} kW delivered`,
        status: state.clinicDeliveredKw > 0 ? "Critical load protected" : "Critical load at risk",
        statusTone: state.clinicDeliveredKw > 0 ? "normal" : "warning",
      };
    case "water":
      return {
        ...node,
        metric: `${state.waterDeliveredKw} kW delivered`,
        status:
          state.waterContractStatus === "met"
            ? "Pump commitment complete"
            : `${state.waterRuntimeRemainingMinutes} min still required`,
        statusTone: state.waterContractStatus === "at_risk" ? "warning" : "normal",
      };
    case "homes":
      return {
        ...node,
        metric: state.homesDeferred
          ? `${state.homesDeferredKw} kW deferred`
          : `${state.homesDeliveredKw} kW delivered`,
        status: state.homesDeferred ? "Flexible demand deferred" : "Within comfort band",
        statusTone: state.homesDeferred ? "warning" : "normal",
      };
    default:
      return node;
  }
}

function applyScenarioMetadata(node: CanvasNode, scenario?: Scenario): CanvasNode {
  if (!scenario) return node;
  const assetTypeByNode: Partial<
    Record<CanvasNode["id"], Scenario["site"]["assets"][number]["type"]>
  > = {
    solar: "solar",
    wind: "wind",
    battery: "battery",
    diesel: "diesel",
  };
  const serviceModeByNode: Partial<
    Record<CanvasNode["id"], Scenario["site"]["services"][number]["control_mode"]>
  > = {
    clinic: "fixed",
    water: "shiftable",
    homes: "curtailable",
  };
  const assetType = assetTypeByNode[node.id];
  if (assetType) {
    const asset = scenario.site.assets.find((item) => item.type === assetType);
    return asset ? { ...node, title: asset.name } : node;
  }
  const serviceMode = serviceModeByNode[node.id];
  if (serviceMode) {
    const service = scenario.site.services.find((item) => item.control_mode === serviceMode);
    return service ? { ...node, title: service.name, detail: service.description } : node;
  }
  if (node.id === "controller") {
    return { ...node, detail: scenario.site.name };
  }
  return node;
}

function applyCanvasView(node: CanvasNode, view: CanvasView): CanvasNode {
  if (view === "architecture") return node;

  const emphasizedIds =
    view === "forecast"
      ? new Set(["solar", "wind", "battery", "controller"])
      : new Set(["diesel", "controller", "clinic", "water", "homes"]);

  return emphasizedIds.has(node.id) ? node : { ...node, dimmed: true };
}

function connectionIsEmphasized(fromId: string, toId: string, view: CanvasView) {
  if (view === "architecture") return true;
  if (view === "forecast") {
    return ["solar", "wind", "battery"].includes(fromId);
  }
  return fromId === "diesel" || fromId === "controller" || toId === "controller";
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function snap(value: number) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}
