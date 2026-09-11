import { SidebarInset, SidebarProvider } from "@getficksd/ui/components/sidebar";
import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import { DemoWorkspaceProvider } from "@/lib/demo-workspace";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  return (
    <DemoWorkspaceProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-h-svh">
          <AppTopbar />
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </DemoWorkspaceProvider>
  );
}
