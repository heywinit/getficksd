import { Button } from "@getficksd/ui/components/button";
import {
  BatteryChargingIcon,
  CrossIcon,
  DropletsIcon,
  FuelIcon,
  GaugeIcon,
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

export type CanvasView = "activity" | "architecture" | "forecast";

type CanvasNode = {
  id: string;
  kind?: "asset" | "controller" | "service";
  resourceId?: string;
  assetType?: Scenario["site"]["assets"][number]["type"];
  serviceMode?: Scenario["site"]["services"][number]["control_mode"];
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
    };

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

function createCanvasNodes(scenario?: Scenario): CanvasNode[] {
  if (!scenario) return initialNodes;

  const assetTemplates: Record<NonNullable<CanvasNode["assetType"]>, CanvasNode> = {
    solar: initialNodes[0],
    wind: initialNodes[1],
    battery: initialNodes[2],
    diesel: initialNodes[3],
  };
  const serviceTemplates: Record<NonNullable<CanvasNode["serviceMode"]>, CanvasNode> = {
    fixed: initialNodes[5],
    shiftable: initialNodes[6],
    curtailable: initialNodes[7],
  };
  const typeCounts = new Map<CanvasNode["assetType"], number>();
  const modeCounts = new Map<CanvasNode["serviceMode"], number>();
  let extraAssetCount = 0;
  let extraServiceCount = 0;
  const assets = scenario.site.assets.map((asset) => {
    const index = typeCounts.get(asset.type) ?? 0;
    typeCounts.set(asset.type, index + 1);
    const template = assetTemplates[asset.type];
    const position = index === 0 ? template : extraAssetPosition(extraAssetCount++);
    return {
      ...template,
      ...position,
      id: `asset:${asset.id}`,
      kind: "asset" as const,
      resourceId: asset.id,
      assetType: asset.type,
      title: asset.name,
      detail:
        asset.type === "battery"
          ? "Energy storage"
          : asset.type === "diesel"
            ? "Dispatchable supply"
            : "Renewable supply",
    };
  });
  const controller = {
    ...initialNodes[4],
    id: "controller",
    kind: "controller" as const,
    detail: scenario.site.name,
  };
  const services = scenario.site.services.map((service) => {
    const index = modeCounts.get(service.control_mode) ?? 0;
    modeCounts.set(service.control_mode, index + 1);
    const template = serviceTemplates[service.control_mode];
    const position = index === 0 ? template : extraServicePosition(extraServiceCount++);
    return {
      ...template,
      ...position,
      id: `service:${service.id}`,
      kind: "service" as const,
      resourceId: service.id,
      serviceMode: service.control_mode,
      title: service.name,
      detail: service.description || `${service.control_mode} service`,
      metric: `${service.rated_power_kw} kW rated`,
    };
  });
  return [...assets, controller, ...services];
}

function extraAssetPosition(index: number) {
  return { x: 64 + (index % 3) * 312, y: 704 + Math.floor(index / 3) * 208 };
}

function extraServicePosition(index: number) {
  return { x: 1040 + (index % 2) * 236, y: 704 + Math.floor(index / 2) * 192 };
}

function canvasConnections(nodes: CanvasNode[]): Array<[string, string]> {
  const controller = nodes.find((node) => node.kind === "controller" || node.id === "controller");
  if (!controller) return [];
  return nodes.flatMap((node): Array<[string, string]> => {
    if (node.id === controller.id) return [];
    return node.kind === "service" ? [[controller.id, node.id]] : [[node.id, controller.id]];
  });
}

function worldSize(nodes: CanvasNode[]) {
  return nodes.reduce(
    (size, node) => ({
      width: Math.max(size.width, node.x + node.width + 48),
      height: Math.max(size.height, node.y + node.height + 48),
    }),
    { width: WORLD_WIDTH, height: WORLD_HEIGHT },
  );
}

export function DeploymentCanvas({
  view = "architecture",
  scenario,
  run,
  onViewChange,
}: {
  view?: CanvasView;
  scenario?: Scenario;
  run?: PlanRun;
  onViewChange?: (view: CanvasView) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState(() => createCanvasNodes(scenario));
  const [transform, setTransform] = useState<CanvasTransform>({
    x: 32,
    y: 24,
    scale: 0.9,
  });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>("controller");
  const [isTimelineExpanded, setIsTimelineExpanded] = useState(false);
  const [currentHour, setCurrentHour] = useState(10.5);
  const [isPlaying, setIsPlaying] = useState(false);
  const canvasSize = useMemo(() => worldSize(nodes), [nodes]);

  useEffect(() => {
    const nextNodes = createCanvasNodes(scenario);
    setNodes((current) => {
      const positions = new Map(current.map((node) => [node.id, { x: node.x, y: node.y }]));
      return nextNodes.map((node) => ({ ...node, ...positions.get(node.id) }));
    });
    setSelectedNode((current) =>
      nextNodes.some((node) => node.id === current) ? current : "controller",
    );
  }, [scenario]);

  const fitView = useCallback(() => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;

    const availableHeight = bounds.height;
    const scale = clamp(
      Math.min((bounds.width - 96) / canvasSize.width, (availableHeight - 64) / canvasSize.height),
      MIN_SCALE,
      1,
    );

    setTransform({
      scale,
      x: bounds.width < 768 ? 24 : Math.round((bounds.width - canvasSize.width * scale) / 2),
      y: Math.max(24, Math.round((availableHeight - canvasSize.height * scale) / 2)),
    });
  }, [canvasSize]);

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
    if (!run || !isPlaying) return;
    const timer = window.setInterval(() => {
      setCurrentHour((hour) => (hour >= 24 ? 0 : hour + 1 / 60));
    }, 100);
    return () => window.clearInterval(timer);
  }, [isPlaying, run]);

  const operatingState = useMemo(
    () => operatingStateAt(currentHour, scenario, run),
    [currentHour, run, scenario],
  );
  const sceneNodes = useMemo(
    () => nodes.map((node) => applyCanvasView(applyOperatingState(node, operatingState), view)),
    [nodes, operatingState, view],
  );
  const nodeLookup = useMemo(
    () => new Map(sceneNodes.map((node) => [node.id, node])),
    [sceneNodes],
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
    const x = snap(pointerX - drag.offsetX);
    const y = snap(pointerY - drag.offsetY);

    setNodes((current) =>
      current.map((node) => (node.id === drag.nodeId ? { ...node, x, y } : node)),
    );
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (canvasRef.current?.hasPointerCapture(event.pointerId)) {
      canvasRef.current.releasePointerCapture(event.pointerId);
    }
    setDrag(null);
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
    setNodes(createCanvasNodes(scenario));
    setSelectedNode("controller");
    fitView();
  };

  return (
    <div
      ref={canvasRef}
      className={`relative h-full min-h-0 w-full touch-none overflow-hidden bg-background select-none ${drag?.type === "canvas" ? "cursor-grabbing" : "cursor-grab"}`}
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
        className="absolute right-4 top-4 z-20 flex rounded-lg border border-border bg-popover/95 p-1 shadow-2xl backdrop-blur"
        role="group"
        aria-label="Canvas view"
      >
        {(
          [
            ["architecture", "System"],
            ["forecast", "Supply"],
            ["activity", "Loads"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              view === value
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-pressed={view === value}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onViewChange?.(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className="absolute left-0 top-0"
        style={{
          width: canvasSize.width,
          height: canvasSize.height,
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: "0 0",
        }}
      >
        <svg
          className="pointer-events-none absolute inset-0 overflow-visible"
          width={canvasSize.width}
          height={canvasSize.height}
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
          {canvasConnections(sceneNodes).map(([fromId, toId]) => {
            const from = nodeLookup.get(fromId);
            const to = nodeLookup.get(toId);
            if (!from || !to) return null;
            const emphasized = connectionIsEmphasized(from, to, view);
            const dieselActive =
              from.assetType === "diesel" &&
              Boolean(
                from.resourceId && operatingState.generatorsByAsset[from.resourceId]?.running,
              );
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
        </svg>

        {sceneNodes.map((node) => (
          <ServiceCard
            key={node.id}
            node={node}
            selected={selectedNode === node.id}
            dieselLitres={
              node.assetType === "diesel" && node.resourceId
                ? (operatingState.generatorsByAsset[node.resourceId]?.fuelLiters ?? 0)
                : 0
            }
            onPointerDown={(event) => startNodeDrag(event, node)}
          />
        ))}
      </div>

      <div className="absolute left-4 top-16 flex flex-col gap-2">
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

      {run ? (
        <TimeRail
          currentHour={currentHour}
          expanded={isTimelineExpanded}
          isPlaying={isPlaying}
          run={run}
          scenario={scenario}
          onCurrentHourChange={setCurrentHour}
          onExpandedChange={setIsTimelineExpanded}
          onPlayingChange={setIsPlaying}
        />
      ) : null}
    </div>
  );
}

function ServiceCard({
  node,
  selected,
  dieselLitres,
  onPointerDown,
}: {
  node: CanvasNode;
  selected: boolean;
  dieselLitres: number;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
}) {
  const Icon = node.icon;
  const metric = metricParts(node);
  const accent = accentForNode(node);
  const compact = node.height <= 144;
  const spacious = node.height >= 176;
  const radius =
    node.assetType === "solar"
      ? "rounded-[28px]"
      : node.kind === "controller" || node.id === "controller"
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
        </span>
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
        {node.assetType === "diesel" || node.id === "diesel" ? (
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
        style={{
          backgroundColor: node.statusTone === "warning" ? "var(--destructive)" : accent,
        }}
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
  if (node.assetType === "battery" || node.id === "battery") {
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

  if (node.assetType === "diesel" || node.id === "diesel") {
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

  if (node.serviceMode === "shiftable" || node.id === "water") {
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

  if (node.serviceMode === "fixed" || node.id === "clinic") {
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
  const path =
    paths[node.id] ??
    (node.assetType === "solar"
      ? paths.solar
      : node.assetType === "wind"
        ? paths.wind
        : node.kind === "controller"
          ? paths.controller
          : node.serviceMode === "curtailable"
            ? paths.homes
            : undefined);
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
  if (node.kind === "controller" || node.id === "controller") {
    const match = node.metric.match(/Demand (\d+) kW/);
    return { value: match?.[1] ?? node.metric, unit: match ? "kW demand" : "" };
  }

  const match = node.metric.match(/^([\d.]+)\s*(.*)$/);
  return { value: match?.[1] ?? node.metric, unit: match?.[2] ?? "" };
}

function accentForNode(node: CanvasNode) {
  if (node.assetType === "solar" || node.id === "solar") return "var(--chart-1)";
  if (node.assetType === "wind" || node.id === "wind") return "var(--chart-2)";
  if (node.assetType === "battery" || node.id === "battery") return "var(--chart-3)";
  if (node.assetType === "diesel" || node.id === "diesel") return "var(--chart-4)";
  if (node.serviceMode === "fixed" || node.id === "clinic") return "var(--destructive)";
  if (node.serviceMode === "shiftable" || node.id === "water") return "var(--chart-2)";
  if (node.serviceMode === "curtailable" || node.id === "homes") return "var(--chart-5)";
  if (node.kind === "controller" || node.id === "controller") return "var(--chart-5)";
  return "var(--primary)";
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

function applyOperatingState(
  node: CanvasNode,
  state: ReturnType<typeof operatingStateAt>,
): CanvasNode {
  if (node.kind === "asset" && node.resourceId) {
    if (node.assetType === "solar" || node.assetType === "wind") {
      const output = state.renewableOutputByAsset[node.resourceId] ?? 0;
      return {
        ...node,
        metric: `${output} kW producing`,
        status: output < 0.1 ? "Forecast at zero" : "Forecast online",
        dimmed: output < 0.1,
      };
    }
    if (node.assetType === "battery") {
      const battery = state.batteriesByAsset[node.resourceId];
      return {
        ...node,
        metric: `${battery?.energyKwh ?? 0} / ${battery?.capacityKwh ?? 0} kWh`,
        status: `${battery?.percent ?? 0}% charged`,
        statusTone: (battery?.percent ?? 0) < 25 ? "warning" : "normal",
      };
    }
    if (node.assetType === "diesel") {
      const generator = state.generatorsByAsset[node.resourceId];
      return {
        ...node,
        metric: generator?.running
          ? `${generator.outputKw} kW output`
          : `${generator?.capacityKw ?? 0} kW capacity`,
        status: generator?.running ? "Generator running" : "Standby",
        statusTone: generator?.running ? "active" : "normal",
      };
    }
  }
  if (node.kind === "service" && node.resourceId) {
    const delivery = state.servicesByID[node.resourceId];
    const contract = state.contractsByService[node.resourceId];
    const deferred = delivery?.deferredKw ?? 0;
    const atRisk = contract?.status === "at_risk" || contract?.status === "breached";
    const contractComplete = contract?.status === "met";
    return {
      ...node,
      metric:
        deferred > 0.001 ? `${deferred} kW deferred` : `${delivery?.deliveredKw ?? 0} kW delivered`,
      status: atRisk
        ? "Commitment needs attention"
        : contractComplete
          ? "Commitment complete"
          : deferred > 0.001
            ? "Demand deferred"
            : "Within plan",
      statusTone: atRisk || deferred > 0.001 ? "warning" : "normal",
    };
  }
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

function applyCanvasView(node: CanvasNode, view: CanvasView): CanvasNode {
  if (view === "architecture") return node;

  const emphasized =
    view === "forecast"
      ? node.kind === "asset" || node.kind === "controller"
      : node.kind === "service" || node.kind === "controller";
  return emphasized ? node : { ...node, dimmed: true };
}

function connectionIsEmphasized(from: CanvasNode, to: CanvasNode, view: CanvasView) {
  if (view === "architecture") return true;
  if (view === "forecast") return from.kind === "asset" || to.kind === "asset";
  return from.kind === "service" || to.kind === "service" || from.kind === "controller";
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function snap(value: number) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}
