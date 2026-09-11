import { Button } from "@getficksd/ui/components/button";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";

import Header from "@/components/header";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <div className="min-h-svh bg-background">
      <Header />
      <main className="relative isolate overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,var(--color-primary)/0.12,transparent_42%)]" />
        <div className="mx-auto flex min-h-[calc(100svh-3.5rem)] max-w-5xl flex-col items-center justify-center px-4 py-20 text-center sm:px-6">
          <div className="mb-6 rounded-full border bg-background/80 px-3 py-1 text-xs text-muted-foreground shadow-sm">
            Built for Hackout 26 at DA-IICT
          </div>
          <h1 className="max-w-4xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
            Start building before the problem statement drops.
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
            A ready full-stack workspace for data, maps, authentication, realtime updates, and
            machine-learning experiments.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button size="lg" render={<Link to="/dashboard" preload="intent" />}>
              Open dashboard
              <ArrowRightIcon />
            </Button>
            <Button
              size="lg"
              variant="outline"
              render={
                <a
                  href="https://github.com/heywinit/getficksd"
                  target="_blank"
                  rel="noreferrer"
                />
              }
            >
              View GitHub
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
