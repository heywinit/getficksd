import { createFileRoute } from "@tanstack/react-router";
import { ChartNoAxesCombinedIcon } from "lucide-react";

import { FeaturePlaceholder } from "@/components/feature-placeholder";

export const Route = createFileRoute("/_auth/charts")({
  component: ChartsPage,
});

function ChartsPage() {
  return (
    <FeaturePlaceholder
      title="Charts"
      description="Use the EvilCharts components for dashboards and reports."
      icon={ChartNoAxesCombinedIcon}
    />
  );
}
