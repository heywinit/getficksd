import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@getficksd/ui/components/card";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { LocationPicker, type LocationValue } from "@/components/location-picker";

export const Route = createFileRoute("/_auth/maps")({
  component: MapsPage,
});

function MapsPage() {
  const [location, setLocation] = useState<LocationValue>({
    longitude: 72.6286,
    latitude: 23.1887,
  });

  return (
    <div className="flex w-full max-w-6xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Maps</h1>
        <p className="text-sm text-muted-foreground">
          A MapCN location picker ready for problem-specific map workflows.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Location picker</CardTitle>
          <CardDescription>Uses MapLibre and a token-free Carto basemap.</CardDescription>
        </CardHeader>
        <CardContent>
          <LocationPicker value={location} onChange={setLocation} />
        </CardContent>
      </Card>
    </div>
  );
}
