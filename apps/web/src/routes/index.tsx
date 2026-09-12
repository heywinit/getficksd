import { Button } from "@getficksd/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@getficksd/ui/components/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@getficksd/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@getficksd/ui/components/field";
import { Input } from "@getficksd/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  BatteryChargingIcon,
  CircleGaugeIcon,
  MapPinIcon,
  Loader2Icon,
  PlusIcon,
  RadioTowerIcon,
  SunIcon,
  WindIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { AppHeader } from "@/components/app-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-state";
import { sitesQueryOptions } from "@/lib/site-queries";
import { createSite, type CreateSiteInput, type SiteSummary } from "@/lib/sites";

export const Route = createFileRoute("/")({
  component: SitesHome,
});

function SitesHome() {
  const sitesQuery = useQuery(sitesQueryOptions());
  const [addSiteOpen, setAddSiteOpen] = useState(false);

  return (
    <div className="min-h-svh bg-background text-foreground">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
              Site portfolio
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Your energy sites
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              Review capacity, commitments, and the latest operating plan for every community grid.
            </p>
          </div>
          <Button type="button" onClick={() => setAddSiteOpen(true)}>
            <PlusIcon /> Add site
          </Button>
        </div>

        {sitesQuery.isPending ? <LoadingState label="Loading sites" rows={4} /> : null}
        {sitesQuery.isError ? (
          <ErrorState error={sitesQuery.error} onRetry={() => sitesQuery.refetch()} />
        ) : null}
        {sitesQuery.isSuccess && sitesQuery.data.length === 0 ? (
          <Card>
            <EmptyState
              title="No sites yet"
              description="Add your first site to start planning its energy supply."
              icon={RadioTowerIcon}
              action={
                <Button type="button" onClick={() => setAddSiteOpen(true)}>
                  <PlusIcon /> Add site
                </Button>
              }
            />
          </Card>
        ) : null}
        {sitesQuery.isSuccess && sitesQuery.data.length > 0 ? (
          <section className="grid gap-4 md:grid-cols-2" aria-label="Sites">
            {sitesQuery.data.map((site) => (
              <SiteCard key={site.id} site={site} />
            ))}
          </section>
        ) : null}
        <AddSiteDialog open={addSiteOpen} onOpenChange={setAddSiteOpen} />
      </main>
    </div>
  );
}

const initialSiteInput: CreateSiteInput = {
  name: "",
  location: "",
  timezone: "Asia/Kolkata",
  currency: "INR",
  solar_capacity_kw: 100,
  peak_demand_kw: 75,
};

function AddSiteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [input, setInput] = useState<CreateSiteInput>(initialSiteInput);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: createSite,
    onSuccess: (site) => {
      queryClient.setQueryData<SiteSummary[]>(["sites"], (sites = []) => [site, ...sites]);
      toast.success(`${site.name} was added`);
      setInput(initialSiteInput);
      onOpenChange(false);
      void navigate({ to: "/sites/$siteId", params: { siteId: site.id } });
    },
    onError: (error) => toast.error(error.message),
  });

  function update<K extends keyof CreateSiteInput>(key: K, value: CreateSiteInput[K]) {
    setInput((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate({
      ...input,
      name: input.name.trim(),
      location: input.location.trim(),
      timezone: input.timezone.trim(),
      currency: input.currency.trim().toUpperCase(),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add an energy site</DialogTitle>
            <DialogDescription>
              Wattson creates a starter solar grid and a 24-hour operating scenario.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="site-name">Site name</FieldLabel>
              <Input
                id="site-name"
                autoFocus
                required
                maxLength={100}
                placeholder="Ladakh Community Grid"
                value={input.name}
                onChange={(event) => update("name", event.target.value)}
              />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="site-location">Location</FieldLabel>
              <Input
                id="site-location"
                required
                maxLength={160}
                placeholder="Leh, Ladakh, India"
                value={input.location}
                onChange={(event) => update("location", event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="site-timezone">Timezone</FieldLabel>
              <Input
                id="site-timezone"
                required
                placeholder="Asia/Kolkata"
                value={input.timezone}
                onChange={(event) => update("timezone", event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="site-currency">Currency</FieldLabel>
              <Input
                id="site-currency"
                required
                minLength={3}
                maxLength={3}
                pattern="[A-Za-z]{3}"
                placeholder="INR"
                value={input.currency}
                onChange={(event) => update("currency", event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="site-solar">Solar capacity (kW)</FieldLabel>
              <Input
                id="site-solar"
                type="number"
                required
                min="0.1"
                step="0.1"
                value={input.solar_capacity_kw}
                onChange={(event) => update("solar_capacity_kw", event.target.valueAsNumber)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="site-demand">Peak demand (kW)</FieldLabel>
              <Input
                id="site-demand"
                type="number"
                required
                min="0.1"
                step="0.1"
                value={input.peak_demand_kw}
                onChange={(event) => update("peak_demand_kw", event.target.valueAsNumber)}
              />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-5">
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
              {mutation.isPending ? "Adding site" : "Add site"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SiteCard({ site }: { site: SiteSummary }) {
  const breached = site.latest_run?.summary.contracts_breached ?? 0;
  const statusLabel = site.latest_run
    ? breached > 0
      ? `${breached} commitment${breached === 1 ? "" : "s"} at risk`
      : "Latest plan protects all commitments"
    : "No plan run yet";

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle>{site.name}</CardTitle>
        <CardDescription className="flex items-center gap-1.5">
          <MapPinIcon className="size-3.5 shrink-0" />
          {site.location}
        </CardDescription>
        <CardAction>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium ${
              breached > 0 ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
            }`}
          >
            <span className="size-1.5 rounded-full bg-current" />
            {site.latest_run?.status ?? "ready"}
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Capacity
            icon={SunIcon}
            label="Solar"
            value={`${formatPower(site.capacity.solar_kw)} kW`}
            color="bg-chart-1/15 text-chart-1"
          />
          <Capacity
            icon={WindIcon}
            label="Wind"
            value={`${formatPower(site.capacity.wind_kw)} kW`}
            color="bg-chart-2/15 text-chart-2"
          />
          <Capacity
            icon={BatteryChargingIcon}
            label="Storage"
            value={`${formatPower(site.capacity.battery_kwh)} kWh`}
            color="bg-chart-3/15 text-chart-3"
          />
          <Capacity
            icon={CircleGaugeIcon}
            label="Diesel"
            value={`${formatPower(site.capacity.diesel_kw)} kW`}
            color="bg-chart-4/15 text-chart-4"
          />
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span>
            <strong className="font-medium text-foreground">{site.service_count}</strong> services
          </span>
          <span>
            <strong className="font-medium text-foreground">{site.commitment_count}</strong>{" "}
            commitments
          </span>
          <span>
            <strong className="font-medium text-foreground">{site.event_count}</strong> events
          </span>
        </div>
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">{statusLabel}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {site.current_scenario.name} · revision {site.current_scenario.revision}
          </p>
        </div>
        <Button render={<Link to="/sites/$siteId" params={{ siteId: site.id }} />} size="sm">
          View site
          <ArrowRightIcon />
        </Button>
      </CardFooter>
    </Card>
  );
}

function Capacity({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof SunIcon;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-2.5">
      <div className={`mb-2 grid size-7 place-items-center rounded-md ${color}`}>
        <Icon className="size-3.5" />
      </div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xs font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function formatPower(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}
