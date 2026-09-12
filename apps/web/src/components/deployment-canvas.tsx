import { Button } from "@getficksd/ui/components/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@getficksd/ui/components/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@getficksd/ui/components/tooltip";
import {
  BatteryChargingIcon,
  CrossIcon,
  DropletsIcon,
  FuelIcon,
  GaugeIcon,
  GraduationCapIcon,
  HomeIcon,
  LightbulbIcon,
  Link2Icon,
  LocateFixedIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
  RadioTowerIcon,
  RotateCcwIcon,
  SnowflakeIcon,
  StoreIcon,
  SunIcon,
  Trash2Icon,
  WindIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import { operatingStateAt, TimeRail } from "@/components/time-rail";
import type { GridConnection, PlanRun, Scenario } from "@/lib/plan-run";

const GRID_SIZE = 16;
const WORLD_WIDTH = 1480;
const WORLD_HEIGHT = 688;
const MIN_SCALE = 0.3;
const MAX_SCALE = 2;

export type CanvasView = "activity" | "architecture" | "forecast";
export type CanvasResourceTarget = { kind: "asset" | "service"; id: string };

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

type ConnectionDraft = {
  sourceId: string;
  pointerId?: number;
  x?: number;
  y?: number;
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
    x: 376,
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
    x: 392,
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
  if (!scenario) return [];

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
  let extraAssetCount = 0;
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
    width: 288,
    height: 184,
    x: 720,
    y: 248,
    id: "controller",
    kind: "controller" as const,
    detail: scenario.site.name,
  };
  const services = scenario.site.services.map((service, index) => {
    const template = serviceTemplates[service.control_mode];
    const position = serviceGridPosition(index, scenario.site.services.length);
    const presentation = servicePresentation(service);
    return {
      ...template,
      ...position,
      width: 224,
      height: 136,
      id: `service:${service.id}`,
      kind: "service" as const,
      resourceId: service.id,
      serviceMode: service.control_mode,
      title: service.name,
      detail: service.description || `${service.control_mode} service`,
      metric: `${service.rated_power_kw} kW rated`,
      icon: presentation.icon,
      iconClassName: presentation.iconClassName,
    };
  });
  return [...assets, controller, ...services];
}

function servicePresentation(service: Scenario["site"]["services"][number]) {
  const name = `${service.id} ${service.name}`.toLowerCase();
  if (name.includes("health") || name.includes("clinic")) {
    return { icon: CrossIcon, iconClassName: "bg-destructive/15 text-destructive" };
  }
  if (name.includes("water") || name.includes("pump")) {
    return { icon: DropletsIcon, iconClassName: "bg-chart-2/15 text-chart-2" };
  }
  if (name.includes("telecom") || name.includes("radio")) {
    return { icon: RadioTowerIcon, iconClassName: "bg-chart-3/15 text-chart-3" };
  }
  if (name.includes("school") || name.includes("community center")) {
    return { icon: GraduationCapIcon, iconClassName: "bg-chart-1/15 text-chart-1" };
  }
  if (name.includes("shop") || name.includes("business") || name.includes("workshop")) {
    return { icon: StoreIcon, iconClassName: "bg-chart-4/15 text-chart-4" };
  }
  if (name.includes("light")) {
    return { icon: LightbulbIcon, iconClassName: "bg-chart-1/15 text-chart-1" };
  }
  if (name.includes("cold") || name.includes("storage")) {
    return { icon: SnowflakeIcon, iconClassName: "bg-chart-2/15 text-chart-2" };
  }
  return { icon: HomeIcon, iconClassName: "bg-chart-5/15 text-chart-5" };
}

function extraAssetPosition(index: number) {
  return { x: 64 + (index % 3) * 312, y: 704 + Math.floor(index / 3) * 208 };
}

function serviceGridPosition(index: number, serviceCount: number) {
  const columns = Math.max(1, Math.ceil(serviceCount / 4));
  const rows = Math.ceil(serviceCount / columns);
  const column = index % columns;
  const row = Math.floor(index / columns);
  const cardHeight = 136;
  const rowGap = 28;
  const gridHeight = rows * cardHeight + Math.max(0, rows - 1) * rowGap;
  return {
    x: 1048 + column * 256,
    y: Math.max(32, Math.round((WORLD_HEIGHT - gridHeight) / 2)) + row * (cardHeight + rowGap),
  };
}

function endpointNodeLookup(nodes: CanvasNode[]) {
  return new Map(nodes.map((node) => [node.resourceId ?? node.id, node]));
}

function worldSize(nodes: CanvasNode[]) {
  return nodes.reduce(
    (size, node) => ({
      width: Math.max(size.width, node.x + node.width + 32),
      height: Math.max(size.height, node.y + node.height + 32),
    }),
    { width: WORLD_WIDTH, height: WORLD_HEIGHT },
  );
}

export function DeploymentCanvas({
  view = "architecture",
  scenario,
  run,
  onViewChange,
  onEditResource,
  onRemoveResource,
  onConnectionsChange,
  connectionsUpdating = false,
  playing,
  replayToken = 0,
  onPlayingChange,
  currentHour: controlledCurrentHour,
  onCurrentHourChange: setControlledCurrentHour,
}: {
  view?: CanvasView;
  scenario?: Scenario;
  run?: PlanRun;
  onViewChange?: (view: CanvasView) => void;
  onEditResource?: (target: CanvasResourceTarget) => void;
  onRemoveResource?: (target: CanvasResourceTarget) => void;
  onConnectionsChange?: (connections: GridConnection[]) => void;
  connectionsUpdating?: boolean;
  playing?: boolean;
  replayToken?: number;
  onPlayingChange?: (playing: boolean) => void;
  currentHour?: number;
  onCurrentHourChange?: Dispatch<SetStateAction<number>>;
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
  const [selectedConnection, setSelectedConnection] = useState<string | null>(null);
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft | null>(null);
  const [isTimelineExpanded, setIsTimelineExpanded] = useState(false);
  const [internalCurrentHour, setInternalCurrentHour] = useState(10.5);
  const currentHour = controlledCurrentHour ?? internalCurrentHour;
  const setCurrentHour = setControlledCurrentHour ?? setInternalCurrentHour;
  const [internalPlaying, setInternalPlaying] = useState(false);
  const isPlaying = playing ?? internalPlaying;
  const setIsPlaying = onPlayingChange ?? setInternalPlaying;
  const canvasSize = useMemo(() => worldSize(nodes), [nodes]);
  const playbackHourRef = useRef(currentHour);
  const autoPlayedRunRef = useRef<string | null>(null);

  useEffect(() => {
    const nextNodes = createCanvasNodes(scenario);
    setNodes((current) => {
      const positions = new Map(current.map((node) => [node.id, { x: node.x, y: node.y }]));
      return nextNodes.map((node) => ({ ...node, ...positions.get(node.id) }));
    });
    setSelectedNode((current) =>
      nextNodes.some((node) => node.id === current) ? current : "controller",
    );
    setSelectedConnection((current) =>
      scenario?.site.connections?.some((connection) => connection.id === current) ? current : null,
    );
    setConnectionDraft((current) =>
      current && nextNodes.some((node) => (node.resourceId ?? node.id) === current.sourceId)
        ? current
        : null,
    );
  }, [scenario]);

  useEffect(() => {
    if (replayToken > 0) setCurrentHour(0);
  }, [replayToken]);

  useEffect(() => {
    playbackHourRef.current = currentHour;
  }, [currentHour]);

  useEffect(() => {
    if (
      !run ||
      run.status !== "complete" ||
      run.intervals.length === 0 ||
      autoPlayedRunRef.current === run.id
    ) {
      return;
    }
    autoPlayedRunRef.current = run.id;
    playbackHourRef.current = 0;
    setCurrentHour(0);
    setIsTimelineExpanded(true);
    setIsPlaying(true);
  }, [run, setCurrentHour, setIsPlaying]);

  const fitView = useCallback(() => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;

    const availableHeight = bounds.height;
    const scale = clamp(
      Math.min((bounds.width - 32) / canvasSize.width, (availableHeight - 32) / canvasSize.height),
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
    let animationFrame = 0;
    let previousFrame = performance.now();
    let lastRender = previousFrame;

    const animate = (now: number) => {
      const elapsed = Math.min(now - previousFrame, 250);
      previousFrame = now;
      playbackHourRef.current = Math.min(24, playbackHourRef.current + elapsed / 6_000);

      if (now - lastRender >= 1000 / 30 || playbackHourRef.current >= 24) {
        lastRender = now;
        setCurrentHour(playbackHourRef.current);
      }
      if (playbackHourRef.current >= 24) {
        setIsPlaying(false);
        return;
      }
      animationFrame = window.requestAnimationFrame(animate);
    };

    animationFrame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [isPlaying, run, setCurrentHour, setIsPlaying]);

  const operatingState = useMemo(
    () => operatingStateAt(currentHour, scenario, run),
    [currentHour, run, scenario],
  );
  const sceneNodes = useMemo(
    () => nodes.map((node) => applyCanvasView(applyOperatingState(node, operatingState), view)),
    [nodes, operatingState, view],
  );
  const endpointLookup = useMemo(() => endpointNodeLookup(sceneNodes), [sceneNodes]);
  const connections = scenario?.site.connections ?? [];
  const startCanvasDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedNode(null);
    setSelectedConnection(null);
    setConnectionDraft(null);
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

    event.currentTarget.setPointerCapture(event.pointerId);
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
    if (connectionDraft?.pointerId === event.pointerId) {
      const point = canvasPoint(event, canvasRef.current, transform);
      if (point) setConnectionDraft((current) => (current ? { ...current, ...point } : current));
      return;
    }
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
    if (connectionDraft?.pointerId === event.pointerId) {
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-connection-target]")?.dataset.connectionTarget;
      if (target) completeConnection(target);
      else setConnectionDraft((current) => (current ? { sourceId: current.sourceId } : null));
      if (canvasRef.current?.hasPointerCapture(event.pointerId)) {
        canvasRef.current.releasePointerCapture(event.pointerId);
      }
      return;
    }
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

  const startConnection = (event: PointerEvent<HTMLButtonElement>, sourceId: string) => {
    if (connectionsUpdating) return;
    event.preventDefault();
    event.stopPropagation();
    const point = canvasPoint(event, canvasRef.current, transform);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag(null);
    setSelectedNode(null);
    setSelectedConnection(null);
    setConnectionDraft({ sourceId, pointerId: event.pointerId, ...point });
  };

  const selectConnectionSource = (sourceId: string) => {
    if (connectionsUpdating) return;
    setDrag(null);
    setSelectedNode(null);
    setSelectedConnection(null);
    setConnectionDraft({ sourceId });
  };

  const completeConnection = (targetId: string) => {
    if (!connectionDraft || connectionsUpdating) return;
    const problem = connectionProblem(
      connectionDraft.sourceId,
      targetId,
      endpointLookup,
      connections,
    );
    if (problem) {
      toast.error(problem);
      setConnectionDraft((current) => (current ? { sourceId: current.sourceId } : null));
      return;
    }
    const connection: GridConnection = {
      id: `${connectionDraft.sourceId}-to-${targetId}`,
      source_id: connectionDraft.sourceId,
      target_id: targetId,
    };
    onConnectionsChange?.([...connections, connection]);
    setConnectionDraft(null);
  };

  const deleteConnection = (connectionId: string) => {
    if (connectionsUpdating) return;
    onConnectionsChange?.(connections.filter((connection) => connection.id !== connectionId));
    setSelectedConnection(null);
    setConnectionDraft(null);
  };

  useEffect(() => {
    if (!selectedConnection && !connectionDraft) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (!selectedConnection) return;
        event.preventDefault();
        deleteConnection(selectedConnection);
      }
      if (event.key === "Escape") {
        setSelectedConnection(null);
        setConnectionDraft(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [connectionDraft, connections, connectionsUpdating, selectedConnection]);

  return (
    <div
      ref={canvasRef}
      className={`relative h-full min-h-0 w-full touch-none overflow-hidden bg-background select-none ${drag?.type === "canvas" ? "cursor-grabbing" : "cursor-grab"}`}
      style={{
        backgroundImage:
          "radial-gradient(circle, color-mix(in oklch, var(--muted-foreground) 12%, transparent) 1px, transparent 1.2px)",
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
          className="absolute inset-0 overflow-visible"
          width={canvasSize.width}
          height={canvasSize.height}
          aria-label="Grid connections"
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
          {connections.map((connection) => {
            const from = endpointLookup.get(connection.source_id);
            const to = endpointLookup.get(connection.target_id);
            if (!from || !to) return null;
            const emphasized = connectionIsEmphasized(from, to, view);
            const flowKw = connectionFlowKw(from, to, operatingState);
            const materialFlow = flowKw >= 0.5;
            const normalServiceFlow =
              from.kind === "controller" && to.kind === "service" && to.statusTone !== "warning";
            const attentionFlow = to.statusTone === "warning";
            const animatedFlow = materialFlow && !normalServiceFlow && isPlaying;
            const flowAccent = accentForNode(from.kind === "controller" ? to : from);
            return (
              <g key={connection.id}>
                <path
                  d={connectionPath(from, to)}
                  fill="none"
                  stroke={
                    selectedConnection === connection.id
                      ? "var(--primary)"
                      : attentionFlow
                        ? "var(--destructive)"
                        : materialFlow && !normalServiceFlow
                          ? flowAccent
                          : "var(--muted-foreground)"
                  }
                  strokeOpacity={
                    selectedConnection === connection.id
                      ? 1
                      : attentionFlow
                        ? 0.9
                        : emphasized
                          ? materialFlow && !normalServiceFlow
                            ? 0.72
                            : 0.3
                          : 0.12
                  }
                  strokeWidth={
                    selectedConnection === connection.id || attentionFlow
                      ? 3
                      : materialFlow && !normalServiceFlow
                        ? 2.25
                        : 1.5
                  }
                  strokeDasharray={animatedFlow ? "3 8" : undefined}
                  markerEnd="url(#canvas-arrow)"
                  pointerEvents="none"
                >
                  {animatedFlow ? (
                    <animate
                      attributeName="stroke-dashoffset"
                      from="22"
                      to="0"
                      dur="0.9s"
                      repeatCount="indefinite"
                    />
                  ) : null}
                </path>
                <path
                  d={connectionPath(from, to)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="18"
                  style={{ pointerEvents: "stroke" }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Select connection from ${from.title} to ${to.title}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setSelectedNode(null);
                    setSelectedConnection(connection.id);
                    setConnectionDraft(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedConnection(connection.id);
                    }
                  }}
                />
              </g>
            );
          })}
          {connectionDraft?.x !== undefined && connectionDraft.y !== undefined
            ? (() => {
                const from = endpointLookup.get(connectionDraft.sourceId);
                if (!from) return null;
                return (
                  <path
                    d={draftConnectionPath(from, connectionDraft.x, connectionDraft.y)}
                    fill="none"
                    stroke="var(--primary)"
                    strokeWidth="2"
                    strokeDasharray="6 4"
                    markerEnd="url(#canvas-arrow)"
                    pointerEvents="none"
                  />
                );
              })()
            : null}
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
            onEdit={onEditResource}
            onRemove={onRemoveResource}
            connectionSource={connectionDraft?.sourceId}
            connections={connections}
            endpoints={endpointLookup}
            updatingConnections={connectionsUpdating}
            onStartConnection={startConnection}
            onSelectConnectionSource={selectConnectionSource}
            onCompleteConnection={completeConnection}
          />
        ))}
      </div>

      {selectedConnection ? (
        <div
          className="absolute right-4 top-16 z-30 flex items-center gap-2 rounded-lg border border-border bg-popover/95 p-2 shadow-2xl backdrop-blur"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="px-1 text-xs text-muted-foreground">Connection selected</span>
          <Button
            size="sm"
            variant="destructive"
            disabled={connectionsUpdating}
            onClick={() => deleteConnection(selectedConnection)}
          >
            <Trash2Icon />
            {connectionsUpdating ? "Saving" : "Disconnect"}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Clear connection selection"
            onClick={() => setSelectedConnection(null)}
          >
            <XIcon />
          </Button>
        </div>
      ) : connectionDraft ? (
        <div
          className="absolute right-4 top-16 z-30 flex items-center gap-2 rounded-lg border border-primary/30 bg-popover/95 px-3 py-2 text-xs shadow-2xl backdrop-blur"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Link2Icon className="size-4 text-primary" />
          Select a highlighted input. Press Escape to cancel.
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Cancel connection"
            onClick={() => setConnectionDraft(null)}
          >
            <XIcon />
          </Button>
        </div>
      ) : null}

      <div className="absolute left-4 top-4 flex flex-col gap-2">
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
  onEdit,
  onRemove,
  connectionSource,
  connections,
  endpoints,
  updatingConnections,
  onStartConnection,
  onSelectConnectionSource,
  onCompleteConnection,
}: {
  node: CanvasNode;
  selected: boolean;
  dieselLitres: number;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onEdit?: (target: CanvasResourceTarget) => void;
  onRemove?: (target: CanvasResourceTarget) => void;
  connectionSource?: string;
  connections: GridConnection[];
  endpoints: Map<string, CanvasNode>;
  updatingConnections: boolean;
  onStartConnection: (event: PointerEvent<HTMLButtonElement>, sourceId: string) => void;
  onSelectConnectionSource: (sourceId: string) => void;
  onCompleteConnection: (targetId: string) => void;
}) {
  const [removeArmed, setRemoveArmed] = useState(false);
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
  const resourceTarget =
    node.resourceId && (node.kind === "asset" || node.kind === "service")
      ? ({
          kind: node.kind,
          id: node.resourceId,
        } satisfies CanvasResourceTarget)
      : null;
  const endpointId = node.resourceId ?? node.id;
  const sourcePort = canStartConnection(node);
  const targetPort = canEndConnection(node);
  const targetProblem = connectionSource
    ? connectionProblem(connectionSource, endpointId, endpoints, connections)
    : null;

  return (
    <ContextMenu onOpenChange={(open) => !open && setRemoveArmed(false)}>
      <ContextMenuTrigger
        render={
          <article
            className={`group absolute flex cursor-grab flex-col overflow-visible border border-border bg-card text-left outline-none transition-[box-shadow,opacity,transform] active:cursor-grabbing ${radius} ${selected ? "ring-1 ring-foreground/20" : "hover:-translate-y-0.5"} ${node.statusTone === "warning" ? "ring-2 ring-destructive/40" : node.statusTone === "active" ? "ring-2 ring-chart-4/40" : ""} ${node.dimmed ? "opacity-50" : "opacity-100"}`}
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
          />
        }
      >
        <span
          className="pointer-events-none absolute inset-x-5 top-0 h-px"
          style={{
            background: `linear-gradient(90deg, transparent, color-mix(in oklch, ${accent} 46%, transparent), transparent)`,
          }}
        />
        <span
          className={`flex shrink-0 items-center gap-2.5 ${compact ? "px-3 pt-3" : "px-4 pt-4"}`}
        >
          <span
            className={`grid shrink-0 place-items-center rounded-full ${compact ? "size-9" : "size-10"} ${node.iconClassName}`}
          >
            <Icon className={compact ? "size-4" : "size-5"} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-card-foreground">
              {node.title}
            </span>
          </span>
          {resourceTarget && onEdit ? (
            <Button
              size="icon-xs"
              variant="ghost"
              className="pointer-events-none shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
              aria-label={`Edit ${node.title}`}
              title={`Edit ${node.title}`}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onEdit(resourceTarget);
              }}
            >
              <PencilIcon />
            </Button>
          ) : null}
        </span>

        <span className={`relative block min-h-0 flex-1 ${compact ? "px-3 pt-1.5" : "px-4 pt-3"}`}>
          <span className="relative z-10 flex items-baseline gap-1.5">
            <span
              className={`${spacious ? "text-[30px]" : "text-2xl"} font-medium tracking-[-0.04em] text-card-foreground`}
            >
              {metric.value}
            </span>
            <span className="max-w-24 truncate text-[10px] text-muted-foreground">
              {metric.unit}
            </span>
          </span>
          {node.assetType === "diesel" || node.id === "diesel" ? (
            <DieselIntake litres={dieselLitres} status={node.status} statusTone={node.statusTone} />
          ) : (
            <>
              <NodeVisual node={node} accent={accent} />
              {node.statusTone === "warning" ? <StatusPill node={node} compact={compact} /> : null}
            </>
          )}
        </span>
        {targetPort ? (
          <button
            type="button"
            data-connection-target={endpointId}
            aria-label={`Connect to ${node.title}`}
            aria-disabled={Boolean(connectionSource && targetProblem)}
            title={
              connectionSource
                ? (targetProblem ?? `Connect to ${node.title}`)
                : `Input for ${node.title}`
            }
            className={`absolute -left-6 top-1/2 z-30 grid size-5 -translate-y-1/2 place-items-center rounded-full border-2 outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring ${
              connectionSource
                ? targetProblem
                  ? "scale-90 border-destructive bg-card text-destructive"
                  : "scale-125 border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground bg-card text-muted-foreground hover:border-primary hover:text-primary"
            }`}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (connectionSource) onCompleteConnection(endpointId);
            }}
            onKeyDown={(event) => {
              if (connectionSource && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onCompleteConnection(endpointId);
              }
            }}
          >
            <span className="size-1.5 rounded-full bg-current" />
          </button>
        ) : null}
        {sourcePort ? (
          <button
            type="button"
            aria-label={`Start a connection from ${node.title}`}
            aria-pressed={connectionSource === endpointId}
            disabled={updatingConnections}
            title={`Output from ${node.title}`}
            className={`absolute -right-6 top-1/2 z-30 grid size-5 -translate-y-1/2 place-items-center rounded-full border-2 bg-card outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring ${
              connectionSource === endpointId
                ? "scale-125 border-primary text-primary"
                : "border-muted-foreground text-muted-foreground hover:border-primary hover:text-primary"
            }`}
            onPointerDown={(event) => onStartConnection(event, endpointId)}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (event.detail === 0) onSelectConnectionSource(endpointId);
            }}
          >
            <span className="size-1.5 rounded-full bg-current" />
          </button>
        ) : null}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40" onPointerDown={(event) => event.stopPropagation()}>
        <ContextMenuItem
          disabled={!resourceTarget}
          onClick={() => resourceTarget && onEdit?.(resourceTarget)}
        >
          <PencilIcon />
          Edit
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          disabled={!resourceTarget}
          closeOnClick={removeArmed}
          onClick={() => {
            if (!resourceTarget) return;
            if (!removeArmed) {
              setRemoveArmed(true);
              return;
            }
            onRemove?.(resourceTarget);
          }}
        >
          <Trash2Icon />
          {removeArmed ? "Confirm?" : "Remove"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function StatusPill({ node, compact }: { node: CanvasNode; compact: boolean }) {
  const statusColor =
    node.statusTone === "warning"
      ? "var(--destructive)"
      : node.statusTone === "active"
        ? "var(--chart-4)"
        : "var(--primary)";

  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={`absolute z-10 flex max-w-[172px] items-center gap-1.5 truncate rounded-full bg-muted px-2 py-1 text-[9px] ${compact ? "bottom-2.5 left-3" : "bottom-3 left-4"} ${node.statusTone === "warning" ? "text-destructive" : "text-muted-foreground"}`}
            />
          }
        >
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: statusColor }}
          />
          <span className="truncate">{node.status}</span>
        </TooltipTrigger>
        <TooltipContent side="top">{statusExplanation(node)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function statusExplanation(node: CanvasNode) {
  if (node.statusTone === "warning") {
    return "Red means that demand is deferred or the plan needs operator attention.";
  }
  if (node.statusTone === "active") {
    return "Amber means that this resource is active at the selected plan time.";
  }
  if (node.kind === "service") {
    return "Green means that this service receives its scheduled power and remains within the plan.";
  }
  return "Green means that this resource operates normally at the selected plan time.";
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
      <span
        className={`absolute bottom-3 right-3 grid size-10 place-items-center rounded-full border text-sm font-medium ${
          node.statusTone === "warning"
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : "border-border bg-muted text-muted-foreground"
        }`}
      >
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
    const match = node.metric.match(/^([\d.]+) \/ ([\d.]+) kW$/);
    return {
      value: match?.[1] ?? node.metric,
      unit: match ? `of ${match[2]} kW served` : "",
    };
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

function canStartConnection(node: CanvasNode) {
  return node.kind === "asset" || node.kind === "controller";
}

function canEndConnection(node: CanvasNode) {
  return (
    node.kind === "controller" ||
    node.kind === "service" ||
    (node.kind === "asset" && node.assetType === "battery")
  );
}

function connectionFlowKw(
  from: CanvasNode,
  to: CanvasNode,
  state: ReturnType<typeof operatingStateAt>,
) {
  if (from.kind === "controller" && to.kind === "service" && to.resourceId) {
    return state.servicesByID[to.resourceId]?.deliveredKw ?? 0;
  }
  if (from.kind === "controller" && to.assetType === "battery" && to.resourceId) {
    return state.batteriesByAsset[to.resourceId]?.chargeKw ?? 0;
  }
  if (from.kind !== "asset" || !from.resourceId) return 0;
  if (from.assetType === "solar" || from.assetType === "wind") {
    return state.renewableOutputByAsset[from.resourceId] ?? 0;
  }
  if (from.assetType === "diesel") {
    return state.generatorsByAsset[from.resourceId]?.outputKw ?? 0;
  }
  if (from.assetType === "battery") {
    return state.batteriesByAsset[from.resourceId]?.dischargeKw ?? 0;
  }
  return 0;
}

function connectionProblem(
  sourceId: string,
  targetId: string,
  endpoints: Map<string, CanvasNode>,
  connections: GridConnection[],
) {
  const source = endpoints.get(sourceId);
  const target = endpoints.get(targetId);
  if (!source || !target) return "This connection uses a grid item that does not exist.";
  if (sourceId === targetId) return "A grid item cannot connect to itself.";
  if (
    connections.some(
      (connection) => connection.source_id === sourceId && connection.target_id === targetId,
    )
  ) {
    return "This connection already exists.";
  }

  if (source.kind === "controller") {
    if (target.kind === "service" || target.assetType === "battery") return null;
    return "The controller can send power only to a battery or consumer.";
  }
  if (source.kind !== "asset") return "Consumers cannot supply another grid item.";
  if (source.assetType === "battery") {
    return target.kind === "controller" ? null : "A battery output must connect to the controller.";
  }
  if (
    source.assetType === "solar" ||
    source.assetType === "wind" ||
    source.assetType === "diesel"
  ) {
    if (target.kind === "controller" || target.assetType === "battery") return null;
    return "Generation can connect only to the controller or a battery.";
  }
  return "This output cannot connect to the selected input.";
}

function canvasPoint(
  event: { clientX: number; clientY: number },
  canvas: HTMLDivElement | null,
  transform: CanvasTransform,
) {
  const bounds = canvas?.getBoundingClientRect();
  if (!bounds) return undefined;
  return {
    x: (event.clientX - bounds.left - transform.x) / transform.scale,
    y: (event.clientY - bounds.top - transform.y) / transform.scale,
  };
}

function connectionPath(from: CanvasNode, to: CanvasNode) {
  const startX = from.x + from.width + 14;
  const fromCenterY = from.y + from.height / 2;
  const endX = to.x - 14;
  const toCenterY = to.y + to.height / 2;
  const bend = Math.max(64, Math.abs(endX - startX) * 0.42);
  return `M ${startX} ${fromCenterY} C ${startX + bend} ${fromCenterY}, ${endX - bend} ${toCenterY}, ${endX} ${toCenterY}`;
}

function draftConnectionPath(from: CanvasNode, targetX: number, targetY: number) {
  const startX = from.x + from.width + 14;
  const startY = from.y + from.height / 2;
  const bend = Math.max(64, Math.abs(targetX - startX) * 0.42);
  return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${targetX - bend} ${targetY}, ${targetX} ${targetY}`;
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
        metric: `${state.servedKw} / ${state.demandKw} kW`,
        status: state.contractAtRisk
          ? "A commitment needs attention"
          : state.deferredKw > 0.001
            ? `${state.deferredKw} kW demand deferred`
            : state.dieselOn
              ? "Dispatching backup generation"
              : "All commitments protected",
        statusTone:
          state.contractAtRisk || state.deferredKw > 0.001
            ? "warning"
            : state.dieselOn
              ? "active"
              : "normal",
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
