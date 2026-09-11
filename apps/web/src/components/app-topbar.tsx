import { Separator } from "@getficksd/ui/components/separator";
import { SidebarTrigger } from "@getficksd/ui/components/sidebar";
import { useRouterState } from "@tanstack/react-router";

const pageNames: Record<string, string> = {
  "/dashboard": "Dashboard",
};

export function AppTopbar() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const pageName = pageNames[pathname] ?? "Wattson";

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-4" />
      <span className="text-sm font-medium">{pageName}</span>
    </header>
  );
}
