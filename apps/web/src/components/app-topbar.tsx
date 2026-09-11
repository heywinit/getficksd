import { Separator } from "@getficksd/ui/components/separator";
import { SidebarTrigger } from "@getficksd/ui/components/sidebar";
import { useRouterState } from "@tanstack/react-router";

import { CommandPalette } from "@/components/command-palette";

const pageNames: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/datasets": "Datasets",
  "/maps": "Maps",
  "/charts": "Charts",
  "/members": "Members",
  "/settings": "Settings",
};

export function AppTopbar() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const pageName = pageNames[pathname] ?? "Workspace";

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-4" />
      <span className="text-sm font-medium">{pageName}</span>
      <CommandPalette />
    </header>
  );
}
