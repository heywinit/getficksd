import { useEffect, useRef } from "react";
import { toast } from "sonner";

import type { PlanRun, Scenario } from "@/lib/plan-run";

export function ReplayNotifications({
  scenario,
  run,
  currentHour,
  isPlaying,
  replayToken,
}: {
  scenario?: Scenario;
  run?: PlanRun;
  currentHour: number;
  isPlaying: boolean;
  replayToken: number;
}) {
  const previousHour = useRef(0);
  const notified = useRef(new Set<string>());

  useEffect(() => {
    previousHour.current = 0;
    notified.current.clear();
  }, [replayToken, run?.id]);

  useEffect(() => {
    if (!scenario || !run) return;

    const previous = previousHour.current;
    if (currentHour + 0.01 < previous) {
      previousHour.current = currentHour;
      notified.current.clear();
      return;
    }

    if (!isPlaying && currentHour < 23.99) {
      previousHour.current = currentHour;
      return;
    }

    const activeEventIDs = new Set(run.active_event_ids);
    for (const event of scenario.events) {
      if (!activeEventIDs.has(event.id)) continue;
      const startHour = eventStartHour(event, scenario);
      if (startHour === null || startHour <= previous || startHour > currentHour) continue;
      const notificationID = `${run.id}:event:${event.id}`;
      if (notified.current.has(notificationID)) continue;
      notified.current.add(notificationID);
      toast.warning(event.name, {
        id: notificationID,
        description: `Disruption started at ${formatHour(startHour)} plan time.`,
        duration: 5_000,
      });
    }

    for (const decision of run.decisions) {
      const hour = decision.interval_index * (scenario.horizon.interval_minutes / 60);
      if (hour <= previous || hour > currentHour) continue;
      const notificationID = `${run.id}:decision:${decision.id}`;
      if (notified.current.has(notificationID)) continue;
      notified.current.add(notificationID);
      toast.info(decision.title, {
        id: notificationID,
        description: decision.reason,
        duration: 5_000,
      });
    }

    if (currentHour >= 23.99 && previous < 23.99) {
      const notificationID = `${run.id}:complete`;
      if (!notified.current.has(notificationID)) {
        notified.current.add(notificationID);
        const protectedCount = run.summary.contracts_met;
        toast.success("Plan replay complete", {
          id: notificationID,
          description: `${protectedCount} commitments protected with ${formatNumber(run.summary.unserved_energy_kwh)} kWh unserved.`,
          duration: 6_000,
        });
      }
    }

    previousHour.current = currentHour;
  }, [currentHour, isPlaying, run, scenario]);

  return null;
}

function eventStartHour(event: Scenario["events"][number], scenario: Scenario) {
  const start = event.start ?? event.scheduled_at;
  if (!start) return null;
  const horizonStart = new Date(scenario.horizon.starts_at).getTime();
  return Math.max(0, (new Date(start).getTime() - horizonStart) / 3_600_000);
}

function formatHour(hour: number) {
  const totalMinutes = Math.round(hour * 60);
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}
