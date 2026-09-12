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
import { Label } from "@getficksd/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@getficksd/ui/components/select";
import {
  AlertTriangleIcon,
  Clock3Icon,
  Edit3Icon,
  LoaderCircleIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Scenario } from "@/lib/plan-run";

type ScenarioEvent = Scenario["events"][number];
type EventType = ScenarioEvent["type"];
type Draft = {
  id?: string;
  name: string;
  type: EventType;
  targetId: string;
  start: string;
  end: string;
  multiplier: string;
};

const labels: Record<EventType, string> = {
  asset_outage: "Equipment outage",
  renewable_shortfall: "Renewable shortfall",
  demand_surge: "Demand surge",
  fuel_delivery_delay: "Fuel delivery delay",
};

export function DisruptionManager({
  scenario,
  isSaving,
  onSave,
}: {
  scenario?: Scenario;
  isSaving: boolean;
  onSave: (scenario: Scenario) => Promise<Scenario>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const edit = (event?: ScenarioEvent) => {
    if (!scenario) return;
    setDraft(event ? fromEvent(event, scenario) : newDraft(scenario));
    setError("");
    setOpen(true);
  };
  const save = async () => {
    if (!scenario || !draft) return;
    try {
      const next = structuredClone(scenario);
      const value = toEvent(draft, scenario);
      const index = draft.id ? next.events.findIndex((event) => event.id === draft.id) : -1;
      if (index < 0) next.events.push(value);
      else next.events[index] = value;
      await onSave(next);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The disruption could not be saved.");
    }
  };
  const remove = async (event: ScenarioEvent) => {
    if (!scenario) return;
    const next = structuredClone(scenario);
    next.events = next.events.filter((item) => item.id !== event.id);
    try {
      await onSave(next);
    } catch {
      // The parent mutation shows the backend error.
    }
  };

  return (
    <div className="min-h-16 rounded-lg border border-border bg-background p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Stress events
        </p>
        <Button size="xs" variant="outline" onClick={() => edit()} disabled={!scenario || isSaving}>
          <PlusIcon />
          Add disruption
        </Button>
      </div>
      <div className="grid gap-2">
        {scenario?.events.length ? (
          scenario.events.map((event) => (
            <div
              key={event.id}
              className="flex items-start gap-2 rounded-md border border-border bg-card p-2"
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => edit(event)}
              >
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <AlertTriangleIcon className="size-3.5 text-primary" />
                  <span className="truncate">{event.name}</span>
                </span>
                <span className="mt-1 block text-[10px] text-muted-foreground">
                  {labels[event.type]} · {targetName(event, scenario)}
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock3Icon className="size-3" />
                  {windowLabel(event, scenario)} · {severity(event)}
                </span>
              </button>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => edit(event)}
                disabled={isSaving}
                aria-label={`Edit ${event.name}`}
              >
                <Edit3Icon />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => void remove(event)}
                disabled={isSaving}
                aria-label={`Remove ${event.name}`}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">No disruptions configured.</span>
        )}
      </div>
      <Editor
        scenario={scenario}
        open={open}
        draft={draft}
        error={error}
        isSaving={isSaving}
        onOpenChange={setOpen}
        onChange={setDraft}
        onSave={() => void save()}
      />
    </div>
  );
}

function Editor({
  scenario,
  open,
  draft,
  error,
  isSaving,
  onOpenChange,
  onChange,
  onSave,
}: {
  scenario?: Scenario;
  open: boolean;
  draft: Draft | null;
  error: string;
  isSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (draft: Draft) => void;
  onSave: () => void;
}) {
  if (!scenario || !draft) return null;
  const targets = targetsFor(scenario, draft.type);
  const fuel = draft.type === "fuel_delivery_delay";
  const minimum = localValue(scenario.horizon.starts_at, scenario.site.timezone);
  const maximum = localValue(
    fuel ? lastIntervalStart(scenario) : horizonEnd(scenario),
    scenario.site.timezone,
  );
  const changeType = (type: EventType) => {
    const times = type === "fuel_delivery_delay" ? fuelDeliveryTimes(scenario) : null;
    onChange({
      ...draft,
      type,
      name: labels[type],
      targetId: targetsFor(scenario, type)[0]?.id ?? "",
      start: times ? localValue(times.start, scenario.site.timezone) : draft.start,
      end: times ? localValue(times.end, scenario.site.timezone) : draft.end,
      multiplier: type === "demand_surge" ? "1.2" : "0",
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{draft.id ? "Edit disruption" : "Add disruption"}</DialogTitle>
          <DialogDescription>
            Times use {scenario.site.timezone}. Saving this change clears the current plan.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <Field label="Disruption type">
            <Select value={draft.type} onValueChange={(value) => value && changeType(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(labels) as EventType[]).map((type) => (
                  <SelectItem key={type} value={type}>
                    {labels[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Name">
            <Input
              value={draft.name}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
            />
          </Field>
          <Field
            label={
              draft.type === "asset_outage"
                ? "Equipment"
                : draft.type === "demand_surge"
                  ? "Consumer demand"
                  : "Forecast"
            }
          >
            <Select
              value={draft.targetId}
              onValueChange={(targetId) => targetId && onChange({ ...draft, targetId })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a target" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((target) => (
                  <SelectItem key={target.id} value={target.id}>
                    {target.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!targets.length ? (
              <p className="text-xs text-destructive">This site has no compatible target.</p>
            ) : null}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={fuel ? "Scheduled arrival" : "Starts at"}>
              <Input
                type="datetime-local"
                step={scenario.horizon.interval_minutes * 60}
                min={minimum}
                max={maximum}
                value={draft.start}
                onChange={(event) => onChange({ ...draft, start: event.target.value })}
              />
            </Field>
            <Field label={fuel ? "Delayed arrival" : "Ends at"}>
              <Input
                type="datetime-local"
                step={scenario.horizon.interval_minutes * 60}
                min={minimum}
                max={maximum}
                value={draft.end}
                onChange={(event) => onChange({ ...draft, end: event.target.value })}
              />
            </Field>
          </div>
          {!fuel ? (
            <Field
              label={draft.type === "demand_surge" ? "Demand multiplier" : "Available capacity (%)"}
            >
              <Input
                type="number"
                min={draft.type === "demand_surge" ? 1.01 : 0}
                max={draft.type === "demand_surge" ? undefined : 100}
                step={draft.type === "demand_surge" ? 0.05 : 5}
                value={draft.multiplier}
                onChange={(event) => onChange({ ...draft, multiplier: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {draft.type === "demand_surge"
                  ? "Use 1.2 for a 20% demand increase."
                  : "Use 0% for a complete outage."}
              </p>
            </Field>
          ) : null}
          {error ? (
            <p
              className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={isSaving || !targets.length}>
            {isSaving ? <LoaderCircleIcon className="animate-spin" /> : null}
            {draft.id ? "Save changes" : "Add disruption"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function newDraft(s: Scenario): Draft {
  const start = localValue(s.horizon.starts_at, s.site.timezone);
  const end = localValue(
    new Date(new Date(s.horizon.starts_at).getTime() + 2 * 3_600_000).toISOString(),
    s.site.timezone,
  );
  return {
    name: labels.asset_outage,
    type: "asset_outage",
    targetId: s.site.assets[0]?.id ?? "",
    start,
    end,
    multiplier: "0",
  };
}
function fromEvent(e: ScenarioEvent, s: Scenario): Draft {
  const start = e.type === "fuel_delivery_delay" ? e.scheduled_at : e.start;
  const end = e.type === "fuel_delivery_delay" ? e.delayed_until : e.end;
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    targetId: e.type === "asset_outage" ? (e.asset_id ?? "") : (e.signal_id ?? ""),
    start: localValue(start ?? s.horizon.starts_at, s.site.timezone),
    end: localValue(end ?? horizonEnd(s), s.site.timezone),
    multiplier: String(
      e.type === "demand_surge"
        ? (e.demand_multiplier ?? 1.2)
        : (e.availability_multiplier ?? 0) * 100,
    ),
  };
}

function toEvent(d: Draft, s: Scenario): ScenarioEvent {
  if (!d.name.trim()) throw new Error("Enter a disruption name.");
  if (!d.targetId) throw new Error("Select an affected target.");
  const start = zonedISO(d.start, s.site.timezone);
  const end = zonedISO(d.end, s.site.timezone);
  if (
    +new Date(start) < +new Date(s.horizon.starts_at) ||
    +new Date(end) >
      +new Date(d.type === "fuel_delivery_delay" ? lastIntervalStart(s) : horizonEnd(s))
  )
    throw new Error("Keep both times inside the operating day.");
  if (+new Date(end) <= +new Date(start))
    throw new Error(
      d.type === "fuel_delivery_delay"
        ? "The delayed arrival must follow the scheduled arrival."
        : "The end time must follow the start time.",
    );
  const interval = s.horizon.interval_minutes * 60_000;
  if (
    (+new Date(start) - +new Date(s.horizon.starts_at)) % interval ||
    (+new Date(end) - +new Date(s.horizon.starts_at)) % interval
  )
    throw new Error(`Use ${s.horizon.interval_minutes}-minute time intervals.`);
  const id = d.id ?? uniqueId(s.events.map((event) => event.id));
  if (d.type === "fuel_delivery_delay")
    return {
      id,
      name: d.name.trim(),
      type: d.type,
      signal_id: d.targetId,
      scheduled_at: start,
      delayed_until: end,
    };
  const value = Number(d.multiplier);
  if (!Number.isFinite(value)) throw new Error("Enter a valid severity.");
  if (d.type === "asset_outage") {
    if (value < 0 || value > 100)
      throw new Error("Available capacity must be between 0% and 100%.");
    return {
      id,
      name: d.name.trim(),
      type: d.type,
      asset_id: d.targetId,
      start,
      end,
      availability_multiplier: value / 100,
    };
  }
  if (d.type === "renewable_shortfall") {
    if (value < 0 || value > 100) throw new Error("Available output must be between 0% and 100%.");
    return {
      id,
      name: d.name.trim(),
      type: d.type,
      signal_id: d.targetId,
      start,
      end,
      availability_multiplier: value / 100,
    };
  }
  if (value <= 1) throw new Error("The demand multiplier must be more than 1.");
  return {
    id,
    name: d.name.trim(),
    type: d.type,
    signal_id: d.targetId,
    start,
    end,
    demand_multiplier: value,
  };
}

function targetsFor(s: Scenario, type: EventType) {
  if (type === "asset_outage")
    return s.site.assets.map((item) => ({ id: item.id, name: item.name }));
  const kind =
    type === "renewable_shortfall"
      ? "renewable_availability"
      : type === "demand_surge"
        ? "service_demand"
        : "fuel_delivery";
  return s.signals
    .filter((item) => item.kind === kind)
    .map((item) => ({ id: item.id, name: signalName(item, s) }));
}
function signalName(signal: Scenario["signals"][number], s: Scenario) {
  return (
    s.site.assets.find((item) => item.id === signal.asset_id)?.name ??
    s.site.services.find((item) => item.id === signal.service_id)?.name ??
    signal.id
  );
}
function targetName(e: ScenarioEvent, s: Scenario) {
  if (e.type === "asset_outage")
    return s.site.assets.find((item) => item.id === e.asset_id)?.name ?? "Unknown equipment";
  const signal = s.signals.find((item) => item.id === e.signal_id);
  return signal ? signalName(signal, s) : "Unknown forecast";
}
function windowLabel(e: ScenarioEvent, s: Scenario) {
  const start = e.type === "fuel_delivery_delay" ? e.scheduled_at : e.start;
  const end = e.type === "fuel_delivery_delay" ? e.delayed_until : e.end;
  return `${formatTime(start, s.site.timezone)}–${formatTime(end, s.site.timezone)}`;
}
function severity(e: ScenarioEvent) {
  if (e.type === "fuel_delivery_delay") return "delivery moved";
  if (e.type === "demand_surge") return `${Math.round((e.demand_multiplier ?? 1) * 100)}% demand`;
  return `${Math.round((e.availability_multiplier ?? 0) * 100)}% available`;
}
function formatTime(value: string | undefined, timeZone: string) {
  return value
    ? new Intl.DateTimeFormat(undefined, {
        timeZone,
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "Not set";
}
function localValue(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
function zonedISO(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Enter a valid date and time.");
  const expected = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]);
  let instant = expected;
  for (let pass = 0; pass < 3; pass += 1) {
    const shown = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(
      localValue(new Date(instant).toISOString(), timeZone),
    );
    if (!shown) break;
    instant += expected - Date.UTC(+shown[1], +shown[2] - 1, +shown[3], +shown[4], +shown[5]);
  }
  const result = new Date(instant).toISOString();
  if (localValue(result, timeZone) !== value)
    throw new Error("This local time does not exist in the site timezone.");
  return result;
}
function horizonEnd(s: Scenario) {
  return new Date(
    +new Date(s.horizon.starts_at) + s.horizon.interval_minutes * s.horizon.interval_count * 60_000,
  ).toISOString();
}
function lastIntervalStart(s: Scenario) {
  return new Date(
    +new Date(s.horizon.starts_at) +
      s.horizon.interval_minutes * (s.horizon.interval_count - 1) * 60_000,
  ).toISOString();
}
function fuelDeliveryTimes(s: Scenario) {
  const delivery = s.signals.find((signal) => signal.kind === "fuel_delivery");
  const scheduledIndex = Math.max(0, delivery?.values.findIndex((value) => value > 0) ?? 0);
  const delayedIndex = Math.min(s.horizon.interval_count - 1, scheduledIndex + 4);
  const interval = s.horizon.interval_minutes * 60_000;
  const origin = +new Date(s.horizon.starts_at);
  return {
    start: new Date(origin + scheduledIndex * interval).toISOString(),
    end: new Date(origin + delayedIndex * interval).toISOString(),
  };
}
function uniqueId(ids: string[]) {
  let index = 1;
  while (ids.includes(`event-${index}`)) index += 1;
  return `event-${index}`;
}
