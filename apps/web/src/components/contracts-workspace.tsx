import { Button } from "@getficksd/ui/components/button";
import { Input } from "@getficksd/ui/components/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@getficksd/ui/components/dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BatteryIcon,
  CheckCircle2Icon,
  Clock3Icon,
  DropletsIcon,
  GraduationCapIcon,
  HeartPulseIcon,
  HomeIcon,
  LightbulbIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  RadioTowerIcon,
  ShieldAlertIcon,
  SnowflakeIcon,
  StoreIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  EChartsRadialChart,
  type ChartConfig,
} from "@/components/evilcharts/charts/echarts-radial-chart";
import { updateScenario } from "@/lib/backend";
import type { ContractPriority, ContractStatus, PlanRun, Scenario } from "@/lib/plan-run";

type Contract = Scenario["contracts"][number];
type ContractKind = Contract["kind"];

type CommitmentDraft = {
  id?: string;
  name: string;
  serviceID: string;
  kind: ContractKind;
  priority: ContractPriority;
  amount: number;
  windowStartHours: number;
  deadlineHours: number;
};

type CommitmentTemplateID =
  | "always-available"
  | "critical-minimum"
  | "complete-task"
  | "energy-quota"
  | "evening-service"
  | "productive-window";

const ruleOptions: Array<{
  kind: ContractKind;
  title: string;
  detail: string;
  icon: typeof ZapIcon;
}> = [
  {
    kind: "continuous_power",
    title: "Keep it powered",
    detail: "Protect a minimum power level",
    icon: ZapIcon,
  },
  {
    kind: "runtime_by_deadline",
    title: "Finish enough runtime",
    detail: "Operate for a set number of minutes",
    icon: Clock3Icon,
  },
  {
    kind: "energy_by_deadline",
    title: "Deliver enough energy",
    detail: "Reach an energy target before a deadline",
    icon: BatteryIcon,
  },
];

const commitmentTemplates: Array<{
  id: CommitmentTemplateID;
  title: string;
  detail: string;
  icon: typeof ZapIcon;
}> = [
  {
    id: "always-available",
    title: "Always available",
    detail: "Hold a power floor for the whole day",
    icon: ShieldAlertIcon,
  },
  {
    id: "critical-minimum",
    title: "Critical minimum",
    detail: "Protect a smaller safety load in any window",
    icon: HeartPulseIcon,
  },
  {
    id: "complete-task",
    title: "Complete a task",
    detail: "Run for enough minutes when power is available",
    icon: Clock3Icon,
  },
  {
    id: "energy-quota",
    title: "Daily energy quota",
    detail: "Deliver a total amount of energy by a deadline",
    icon: BatteryIcon,
  },
  {
    id: "evening-service",
    title: "Evening service",
    detail: "Keep a service live during the evening peak",
    icon: LightbulbIcon,
  },
  {
    id: "productive-window",
    title: "Productive-use window",
    detail: "Supply flexible work during business hours",
    icon: StoreIcon,
  },
];

const windowPresets = [
  { title: "Full day", start: 0, end: 24 },
  { title: "Daylight", start: 6, end: 18 },
  { title: "Business", start: 8, end: 20 },
  { title: "Evening", start: 17, end: 24 },
  { title: "Overnight", start: 0, end: 6 },
] as const;

const priorityOptions: Array<{ priority: ContractPriority; title: string; detail: string }> = [
  { priority: "critical", title: "Life or safety", detail: "Protect this first" },
  { priority: "essential", title: "Daily essential", detail: "Protect after critical needs" },
  { priority: "flexible", title: "Can move", detail: "Use the best available time" },
];

const progressChartConfig = {
  Critical: {
    label: "Critical progress",
    colors: { light: ["var(--chart-4)"], dark: ["var(--chart-4)"] },
  },
  Essential: {
    label: "Essential progress",
    colors: { light: ["var(--chart-2)"], dark: ["var(--chart-2)"] },
  },
  Flexible: {
    label: "Flexible progress",
    colors: { light: ["var(--chart-3)"], dark: ["var(--chart-3)"] },
  },
} satisfies ChartConfig;

const progressChartOptions = { animationDuration: 350 };

export const ContractsWorkspace = memo(function ContractsWorkspace({
  scenario,
  run,
}: {
  scenario?: Scenario;
  run?: PlanRun;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Contract | "new" | null>(null);
  const outcomes = useMemo(
    () => new Map(run?.contract_outcomes.map((outcome) => [outcome.contract_id, outcome]) ?? []),
    [run],
  );
  const protectedCount = run?.contract_outcomes.filter(
    (outcome) => outcome.status === "met" || outcome.status === "safe",
  ).length;
  const mutation = useMutation({
    mutationFn: async (next: Scenario) => updateScenario(next),
    onSuccess: (saved) => {
      queryClient.setQueryData(["scenario", saved.id], saved);
      queryClient.setQueryData(["plan-runs", saved.id], []);
      setEditing(null);
      toast.success("Commitments updated. Recalculate the scenario to see the result.");
    },
    onError: (error) => toast.error(error.message),
  });

  const removeContract = (contract: Contract) => {
    if (!scenario || scenario.contracts.length <= 1) return;
    if (!window.confirm(`Remove the commitment for ${contract.name}?`)) return;
    const next = structuredClone(scenario);
    next.contracts = next.contracts.filter((item) => item.id !== contract.id);
    mutation.mutate(next);
  };

  return (
    <section
      className="px-16 pb-8 sm:px-24 lg:px-40 xl:px-48 2xl:px-64"
      aria-labelledby="contracts-title"
    >
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlertIcon className="size-4 text-primary" />
            <h2 id="contracts-title" className="text-lg font-semibold tracking-tight">
              Commitments
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Describe the promise. Wattson creates the scheduling rule.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {run && scenario ? (
            <span className="rounded-full border border-border bg-card px-2.5 py-1 text-xs tabular-nums text-muted-foreground">
              <strong className="font-semibold text-foreground">{protectedCount}</strong>/
              {scenario.contracts.length} protected
            </span>
          ) : null}
          <Button
            size="sm"
            onClick={() => setEditing("new")}
            disabled={!scenario || mutation.isPending}
          >
            <PlusIcon /> Add commitment
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {scenario?.contracts.map((contract) => {
          const service = scenario.site.services.find((item) => item.id === contract.service_id);
          const outcome = outcomes.get(contract.id);
          const progress = contractProgress(contract, outcome);
          const ServiceIcon = serviceIcon(service?.name ?? "");
          return (
            <article
              key={contract.id}
              className="group rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/40"
            >
              <div className="flex items-start gap-2">
                <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <ServiceIcon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium" title={contract.name}>
                    {contract.name}
                  </h3>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {service?.name ?? "Unknown service"}
                  </p>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Edit ${contract.name}`}
                  onClick={() => setEditing(contract)}
                >
                  <PencilIcon />
                </Button>
              </div>

              <div className="mt-3 flex items-center gap-3">
                <CommitmentProgressChart
                  percent={progress.percent}
                  priority={contract.priority}
                  label={`${contract.name}: ${progress.label}`}
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap gap-1">
                    <StatusBadge status={outcome?.status} />
                    <PriorityBadge priority={contract.priority} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Metric label="Target" value={progress.target} />
                    <Metric label="Remaining" value={progress.remaining} />
                  </div>
                </div>
              </div>

              <p className="mt-3 line-clamp-2 min-h-8 text-[10px] leading-4 text-muted-foreground">
                {contractSentence(contract, scenario)}
              </p>
            </article>
          );
        })}
      </div>

      {!scenario ? (
        <div className="h-32 animate-pulse rounded-xl border border-border bg-card" />
      ) : null}

      <CommitmentDialog
        open={editing !== null}
        scenario={scenario}
        contract={editing === "new" ? undefined : (editing ?? undefined)}
        saving={mutation.isPending}
        onOpenChange={(open) => !open && setEditing(null)}
        onSave={(contract) => {
          if (!scenario) return;
          const next = structuredClone(scenario);
          const index = next.contracts.findIndex((item) => item.id === contract.id);
          if (index === -1) next.contracts.push(contract);
          else next.contracts[index] = contract;
          mutation.mutate(next);
        }}
        onRemove={
          editing && editing !== "new" && scenario && scenario.contracts.length > 1
            ? () => removeContract(editing)
            : undefined
        }
      />
    </section>
  );
});

const CommitmentProgressChart = memo(function CommitmentProgressChart({
  percent,
  priority,
  label,
}: {
  percent: number;
  priority: ContractPriority;
  label: string;
}) {
  const name =
    priority === "critical" ? "Critical" : priority === "essential" ? "Essential" : "Flexible";
  const data = useMemo(() => [{ name, value: percent }], [name, percent]);
  return (
    <div className="relative size-[4.75rem] shrink-0" role="img" aria-label={label}>
      <EChartsRadialChart
        className="absolute inset-0"
        data={data}
        config={progressChartConfig}
        nameKey="name"
        max={100}
        innerRadius="60%"
        outerRadius="92%"
        renderer="svg"
        chartOptions={progressChartOptions}
      >
        <EChartsRadialChart.RadialBar dataKey="value" barSize={9} cornerRadius={8} showBackground />
      </EChartsRadialChart>
      <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
        <span className="text-sm font-semibold tabular-nums">{Math.round(percent)}%</span>
      </div>
    </div>
  );
});

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-xs font-medium tabular-nums" title={value}>
        {value}
      </p>
    </div>
  );
}

function CommitmentDialog({
  open,
  scenario,
  contract,
  saving,
  onOpenChange,
  onSave,
  onRemove,
}: {
  open: boolean;
  scenario?: Scenario;
  contract?: Contract;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (contract: Contract) => void;
  onRemove?: () => void;
}) {
  const [draft, setDraft] = useState<CommitmentDraft | null>(null);
  useEffect(() => {
    if (!open || !scenario) return;
    setDraft(contract ? draftFromContract(contract, scenario) : newDraft(scenario));
  }, [contract, open, scenario]);
  if (!scenario || !draft) return null;

  const service = scenario.site.services.find((item) => item.id === draft.serviceID);
  const ratedPower = service?.rated_power_kw ?? 1;
  const amounts = amountOptions(draft.kind, ratedPower, draft);
  const error = commitmentError(draft, ratedPower);
  const updateService = (serviceID: string) => {
    const nextService = scenario.site.services.find((item) => item.id === serviceID);
    setDraft({
      ...draft,
      serviceID,
      name: contract ? draft.name : `${nextService?.name ?? "Service"} promise`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{contract ? "Edit commitment" : "Add a commitment"}</DialogTitle>
          <DialogDescription>
            Start with a familiar promise, then tune every value. The three rule types are reusable
            scheduling building blocks, not fixed examples.
          </DialogDescription>
        </DialogHeader>

        <Question number="1" title="Who needs the power?">
          <div className="grid gap-2 sm:grid-cols-2">
            {scenario.site.services.map((item) => {
              const Icon = serviceIcon(item.name);
              return (
                <ChoiceButton
                  key={item.id}
                  selected={draft.serviceID === item.id}
                  onClick={() => updateService(item.id)}
                >
                  <Icon className="size-4" />
                  <span>
                    <span className="block font-medium">{item.name}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {item.description}
                    </span>
                  </span>
                </ChoiceButton>
              );
            })}
          </div>
        </Question>

        {!contract ? (
          <Question number="2" title="Start with a useful promise">
            <div className="grid gap-2 sm:grid-cols-3">
              {commitmentTemplates.map((item) => (
                <ChoiceButton
                  key={item.id}
                  selected={false}
                  onClick={() => setDraft(applyTemplate(item.id, draft, service))}
                >
                  <item.icon className="size-4" />
                  <span>
                    <span className="block font-medium">{item.title}</span>
                    <span className="block text-[10px] text-muted-foreground">{item.detail}</span>
                  </span>
                </ChoiceButton>
              ))}
            </div>
          </Question>
        ) : null}

        <Question number={contract ? "2" : "3"} title="Define the exact rule">
          <label className="mb-3 block text-xs font-medium">
            Commitment name
            <Input
              className="mt-1.5"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="For example: Evening street-light coverage"
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-3">
            {ruleOptions.map((item) => (
              <ChoiceButton
                key={item.kind}
                selected={draft.kind === item.kind}
                onClick={() =>
                  setDraft({
                    ...draft,
                    kind: item.kind,
                    amount: defaultAmount(item.kind, ratedPower, draft),
                  })
                }
              >
                <item.icon className="size-4" />
                <span>
                  <span className="block font-medium">{item.title}</span>
                  <span className="block text-[10px] text-muted-foreground">{item.detail}</span>
                </span>
              </ChoiceButton>
            ))}
          </div>

          <div className="mt-4 grid gap-4 rounded-xl border border-border bg-muted/30 p-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div>
              <label className="text-xs font-medium" htmlFor="commitment-target">
                {amountQuestion(draft.kind)}
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <Input
                  id="commitment-target"
                  type="number"
                  min={draft.kind === "runtime_by_deadline" ? 1 : 0.1}
                  step={draft.kind === "runtime_by_deadline" ? 1 : 0.1}
                  value={draft.amount}
                  onChange={(event) => setDraft({ ...draft, amount: Number(event.target.value) })}
                />
                <span className="w-12 text-xs text-muted-foreground">{amountUnit(draft.kind)}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {amounts.map((amount) => (
                  <Button
                    key={amount}
                    type="button"
                    size="sm"
                    variant={Math.abs(draft.amount - amount) < 0.001 ? "default" : "outline"}
                    onClick={() => setDraft({ ...draft, amount })}
                  >
                    {formatAmount(draft.kind, amount)}
                  </Button>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                {targetHelp(draft.kind, ratedPower, draft)}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium">When does the promise apply?</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {windowPresets.map((preset) => (
                  <Button
                    key={preset.title}
                    type="button"
                    size="sm"
                    variant={
                      draft.windowStartHours === preset.start && draft.deadlineHours === preset.end
                        ? "default"
                        : "outline"
                    }
                    onClick={() =>
                      setDraft({
                        ...draft,
                        windowStartHours: preset.start,
                        deadlineHours: preset.end,
                      })
                    }
                  >
                    {preset.title}
                  </Button>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="text-[10px] text-muted-foreground">
                  Starts at hour
                  <Input
                    className="mt-1"
                    type="number"
                    min={0}
                    max={23.75}
                    step={0.25}
                    value={draft.windowStartHours}
                    onChange={(event) =>
                      setDraft({ ...draft, windowStartHours: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="text-[10px] text-muted-foreground">
                  Ends at hour
                  <Input
                    className="mt-1"
                    type="number"
                    min={0.25}
                    max={24}
                    step={0.25}
                    value={draft.deadlineHours}
                    onChange={(event) =>
                      setDraft({ ...draft, deadlineHours: Number(event.target.value) })
                    }
                  />
                </label>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
                <span>
                  {formatHorizonHour(draft.windowStartHours, scenario)} –{" "}
                  {formatHorizonHour(draft.deadlineHours, scenario)}
                </span>
                <span>{formatWindowLength(draft)} window</span>
              </div>
            </div>
          </div>
        </Question>

        <Question number={contract ? "3" : "4"} title="How important is this promise?">
          <div className="grid gap-2 sm:grid-cols-3">
            {priorityOptions.map((item) => (
              <ChoiceButton
                key={item.priority}
                selected={draft.priority === item.priority}
                onClick={() => setDraft({ ...draft, priority: item.priority })}
              >
                <span>
                  <span className="block font-medium">{item.title}</span>
                  <span className="block text-[10px] text-muted-foreground">{item.detail}</span>
                </span>
              </ChoiceButton>
            ))}
          </div>
        </Question>

        <div className="rounded-lg border border-primary/30 bg-primary/10 p-3">
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-primary">
            The promise
          </p>
          <p className="mt-1 text-sm">
            {contractSentence(contractFromDraft(draft, scenario), scenario)}
          </p>
          {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        </div>

        <DialogFooter className="sm:justify-between">
          {onRemove ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={onRemove}
              disabled={saving}
            >
              <Trash2Icon /> Remove
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={() => onSave(contractFromDraft(draft, scenario))}
              disabled={saving || Boolean(error)}
            >
              {saving ? <LoaderCircleIcon className="animate-spin" /> : <CheckCircle2Icon />}
              Save commitment
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Question({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset>
      <legend className="mb-2 flex items-center gap-2 text-sm font-medium">
        <span className="grid size-5 place-items-center rounded-full bg-muted text-[10px] text-muted-foreground">
          {number}
        </span>
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function ChoiceButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`flex min-h-16 items-start gap-2 rounded-lg border p-3 text-left text-xs transition-colors ${selected ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function PriorityBadge({ priority }: { priority: ContractPriority }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide ${priority === "critical" ? "bg-destructive/10 text-destructive" : priority === "essential" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
    >
      {priority}
    </span>
  );
}

function StatusBadge({ status }: { status?: ContractStatus }) {
  if (!status)
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] text-muted-foreground">
        Needs plan
      </span>
    );
  const protectedStatus = status === "met" || status === "safe";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${protectedStatus ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}
    >
      {status === "met" ? "Protected" : status === "safe" ? "On track" : "At risk"}
    </span>
  );
}

function contractProgress(contract: Contract, outcome?: PlanRun["contract_outcomes"][number]) {
  if (!outcome)
    return {
      percent: 0,
      label: "Not calculated",
      target: contractTarget(contract),
      remaining: "Run plan",
    };
  if (contract.kind === "runtime_by_deadline") {
    const target = contract.required_runtime_minutes ?? 1;
    const remaining = Math.max(0, target - outcome.delivered_runtime_minutes);
    return {
      percent: clamp((outcome.delivered_runtime_minutes / target) * 100, 0, 100),
      label: `${outcome.delivered_runtime_minutes} min delivered`,
      target: `${formatNumber(target)} min`,
      remaining: `${formatNumber(remaining)} min`,
    };
  }
  if (contract.kind === "energy_by_deadline") {
    const target = contract.required_energy_kwh ?? 1;
    const remaining = Math.max(0, target - outcome.delivered_energy_kwh);
    return {
      percent: clamp((outcome.delivered_energy_kwh / target) * 100, 0, 100),
      label: `${formatNumber(outcome.delivered_energy_kwh)} kWh delivered`,
      target: `${formatNumber(target)} kWh`,
      remaining: `${formatNumber(remaining)} kWh`,
    };
  }
  return {
    percent: outcome.status === "met" ? 100 : 0,
    label:
      outcome.status === "met" ? "Protected for the full window" : "Power fell below the promise",
    target: `${formatNumber(contract.minimum_power_kw ?? 0)} kW`,
    remaining: `${formatNumber(outcome.shortfall)} kWh`,
  };
}

function contractTarget(contract: Contract) {
  if (contract.kind === "runtime_by_deadline")
    return `${formatNumber(contract.required_runtime_minutes ?? 0)} min`;
  if (contract.kind === "energy_by_deadline")
    return `${formatNumber(contract.required_energy_kwh ?? 0)} kWh`;
  return `${formatNumber(contract.minimum_power_kw ?? 0)} kW`;
}

function contractSentence(contract: Contract, scenario: Scenario) {
  const service =
    scenario.site.services.find((item) => item.id === contract.service_id)?.name ?? "This service";
  const windowStart = formatDeadline(contract.window_start, scenario.site.timezone);
  const deadline = formatDeadline(contract.deadline, scenario.site.timezone);
  if (contract.kind === "continuous_power")
    return `Keep ${service} above ${formatNumber(contract.minimum_power_kw ?? 0)} kW from ${windowStart} to ${deadline}.`;
  if (contract.kind === "runtime_by_deadline")
    return `Run ${service} for ${contract.required_runtime_minutes ?? 0} minutes between ${windowStart} and ${deadline}.`;
  return `Deliver ${formatNumber(contract.required_energy_kwh ?? 0)} kWh to ${service} between ${windowStart} and ${deadline}.`;
}

function newDraft(scenario: Scenario): CommitmentDraft {
  const service = scenario.site.services[0];
  return {
    name: `${service?.name ?? "Service"} promise`,
    serviceID: service?.id ?? "",
    kind: "continuous_power",
    priority: "essential",
    amount: Math.max(0.1, round((service?.rated_power_kw ?? 1) * 0.5)),
    windowStartHours: 0,
    deadlineHours: 24,
  };
}

function draftFromContract(contract: Contract, scenario: Scenario): CommitmentDraft {
  const start = new Date(scenario.horizon.starts_at).getTime();
  const windowStartHours = clamp(
    roundToQuarter((new Date(contract.window_start).getTime() - start) / 3_600_000),
    0,
    23.75,
  );
  const deadlineHours = clamp(
    roundToQuarter((new Date(contract.deadline).getTime() - start) / 3_600_000),
    0.25,
    24,
  );
  return {
    id: contract.id,
    name: contract.name,
    serviceID: contract.service_id,
    kind: contract.kind,
    priority: contract.priority,
    amount:
      contract.minimum_power_kw ??
      contract.required_runtime_minutes ??
      contract.required_energy_kwh ??
      1,
    windowStartHours,
    deadlineHours,
  };
}

function contractFromDraft(draft: CommitmentDraft, scenario: Scenario): Contract {
  const service = scenario.site.services.find((item) => item.id === draft.serviceID);
  const horizonStart = new Date(scenario.horizon.starts_at).getTime();
  const windowStart = new Date(horizonStart + draft.windowStartHours * 3_600_000).toISOString();
  const deadline = new Date(horizonStart + draft.deadlineHours * 3_600_000).toISOString();
  const id = draft.id ?? uniqueContractID(scenario);
  const base: Contract = {
    id,
    name: draft.name.trim() || `${service?.name ?? "Service"} promise`,
    service_id: draft.serviceID,
    kind: draft.kind,
    priority: draft.priority,
    window_start: windowStart,
    deadline,
  };
  if (draft.kind === "continuous_power") base.minimum_power_kw = draft.amount;
  if (draft.kind === "runtime_by_deadline")
    base.required_runtime_minutes = Math.round(draft.amount);
  if (draft.kind === "energy_by_deadline") base.required_energy_kwh = draft.amount;
  return base;
}

function amountOptions(kind: ContractKind, ratedPower: number, draft: CommitmentDraft) {
  const windowHours = Math.max(0, draft.deadlineHours - draft.windowStartHours);
  if (kind === "runtime_by_deadline")
    return uniqueNumbers([30, 60, 120, 240, Math.round(windowHours * 60)]).filter(
      (value) => value > 0 && value <= windowHours * 60,
    );
  if (kind === "energy_by_deadline") {
    return uniqueNumbers(
      [0.25, 0.5, 0.75, 1].map((part) => Math.max(0.1, round(ratedPower * windowHours * part))),
    );
  }
  return uniqueNumbers([0.25, 0.5, 0.75, 1].map((part) => Math.max(0.1, round(ratedPower * part))));
}

function applyTemplate(
  template: CommitmentTemplateID,
  draft: CommitmentDraft,
  service?: Scenario["site"]["services"][number],
): CommitmentDraft {
  const ratedPower = service?.rated_power_kw ?? 1;
  const serviceName = service?.name ?? "Service";
  if (template === "always-available")
    return {
      ...draft,
      name: `${serviceName} full-day availability`,
      kind: "continuous_power",
      priority: "essential",
      amount: Math.max(0.1, round(ratedPower * 0.8)),
      windowStartHours: 0,
      deadlineHours: 24,
    };
  if (template === "critical-minimum")
    return {
      ...draft,
      name: `${serviceName} safety minimum`,
      kind: "continuous_power",
      priority: "critical",
      amount: Math.max(0.1, round(ratedPower * 0.4)),
      windowStartHours: 0,
      deadlineHours: 24,
    };
  if (template === "complete-task")
    return {
      ...draft,
      name: `${serviceName} operating-time target`,
      kind: "runtime_by_deadline",
      priority: "essential",
      amount: 180,
      windowStartHours: 6,
      deadlineHours: 20,
    };
  if (template === "energy-quota")
    return {
      ...draft,
      name: `${serviceName} daily energy target`,
      kind: "energy_by_deadline",
      priority: "essential",
      amount: Math.max(0.1, round(ratedPower * 4)),
      windowStartHours: 6,
      deadlineHours: 22,
    };
  if (template === "evening-service")
    return {
      ...draft,
      name: `${serviceName} evening coverage`,
      kind: "continuous_power",
      priority: "essential",
      amount: Math.max(0.1, round(ratedPower * 0.65)),
      windowStartHours: 17,
      deadlineHours: 24,
    };
  return {
    ...draft,
    name: `${serviceName} productive-use allowance`,
    kind: "energy_by_deadline",
    priority: "flexible",
    amount: Math.max(0.1, round(ratedPower * 5)),
    windowStartHours: 8,
    deadlineHours: 20,
  };
}

function defaultAmount(kind: ContractKind, ratedPower: number, draft: CommitmentDraft) {
  const windowHours = Math.max(0.25, draft.deadlineHours - draft.windowStartHours);
  if (kind === "runtime_by_deadline") return Math.min(120, Math.round(windowHours * 60));
  if (kind === "energy_by_deadline")
    return Math.max(0.1, round(ratedPower * Math.min(2, windowHours)));
  return Math.max(0.1, round(ratedPower * 0.5));
}

function commitmentError(draft: CommitmentDraft, ratedPower: number) {
  if (!draft.name.trim()) return "Give this commitment a name.";
  if (!draft.serviceID) return "Choose a service.";
  if (!Number.isFinite(draft.amount) || draft.amount <= 0) return "Enter a target above zero.";
  if (
    !Number.isFinite(draft.windowStartHours) ||
    !Number.isFinite(draft.deadlineHours) ||
    draft.windowStartHours < 0 ||
    draft.deadlineHours > 24 ||
    draft.deadlineHours <= draft.windowStartHours
  )
    return "The time window must start before it ends and stay inside the 24-hour plan.";
  const windowHours = draft.deadlineHours - draft.windowStartHours;
  if (draft.kind === "continuous_power" && draft.amount > ratedPower)
    return `This service is rated for ${formatNumber(ratedPower)} kW. Lower the power target or raise its rated power.`;
  if (draft.kind === "runtime_by_deadline" && draft.amount > windowHours * 60)
    return `This window can contain at most ${formatNumber(windowHours * 60)} operating minutes.`;
  if (draft.kind === "energy_by_deadline" && draft.amount > ratedPower * windowHours)
    return `At ${formatNumber(ratedPower)} kW, this window can deliver at most ${formatNumber(ratedPower * windowHours)} kWh.`;
  return null;
}

function targetHelp(kind: ContractKind, ratedPower: number, draft: CommitmentDraft) {
  const windowHours = Math.max(0, draft.deadlineHours - draft.windowStartHours);
  if (kind === "runtime_by_deadline")
    return `Any whole-minute target is allowed, up to ${formatNumber(windowHours * 60)} minutes in this window.`;
  if (kind === "energy_by_deadline")
    return `Any energy target is allowed. This ${formatNumber(ratedPower)} kW service can physically receive up to ${formatNumber(ratedPower * windowHours)} kWh in this window.`;
  return `Any power floor is allowed up to the service rating of ${formatNumber(ratedPower)} kW.`;
}

function amountQuestion(kind: ContractKind) {
  if (kind === "runtime_by_deadline") return "How long must it run?";
  if (kind === "energy_by_deadline") return "How much energy must arrive?";
  return "What is the minimum safe power?";
}

function formatAmount(kind: ContractKind, amount: number) {
  if (kind === "runtime_by_deadline")
    return amount < 60 ? `${formatNumber(amount)} min` : `${formatNumber(amount / 60)} hr`;
  return `${formatNumber(amount)} ${kind === "energy_by_deadline" ? "kWh" : "kW"}`;
}

function amountUnit(kind: ContractKind) {
  if (kind === "runtime_by_deadline") return "min";
  if (kind === "energy_by_deadline") return "kWh";
  return "kW";
}

function serviceIcon(name: string) {
  const normalized = name.toLowerCase();
  if (normalized.includes("clinic") || normalized.includes("health")) return HeartPulseIcon;
  if (normalized.includes("water") || normalized.includes("pump")) return DropletsIcon;
  if (normalized.includes("telecom") || normalized.includes("radio")) return RadioTowerIcon;
  if (normalized.includes("school") || normalized.includes("community")) return GraduationCapIcon;
  if (normalized.includes("shop") || normalized.includes("business")) return StoreIcon;
  if (normalized.includes("light")) return LightbulbIcon;
  if (normalized.includes("cold") || normalized.includes("storage")) return SnowflakeIcon;
  return HomeIcon;
}

function uniqueContractID(scenario: Scenario) {
  let index = scenario.contracts.length + 1;
  while (scenario.contracts.some((item) => item.id === `commitment-${index}`)) index += 1;
  return `commitment-${index}`;
}

function formatDeadline(timestamp: string, timezone: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatHorizonHour(hours: number, scenario: Scenario) {
  if (!Number.isFinite(hours)) return "Invalid time";
  const timestamp = new Date(new Date(scenario.horizon.starts_at).getTime() + hours * 3_600_000);
  const time = new Intl.DateTimeFormat("en", {
    timeZone: scenario.site.timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
  return hours === 24 ? `${time} next day` : time;
}

function formatWindowLength(draft: CommitmentDraft) {
  const totalMinutes = Math.max(0, Math.round((draft.deadlineHours - draft.windowStartHours) * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function roundToQuarter(value: number) {
  return Math.round(value * 4) / 4;
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values.map((value) => round(value)))];
}
