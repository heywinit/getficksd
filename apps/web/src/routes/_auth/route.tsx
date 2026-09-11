import { SidebarInset, SidebarProvider } from "@getficksd/ui/components/sidebar";
import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import { ErrorState, LoadingState } from "@/components/page-state";
import { sessionQueryOptions } from "@/functions/get-user";

export const Route = createFileRoute("/_auth")({
  component: AuthLayout,
  pendingComponent: () => <LoadingState label="Loading workspace" rows={5} />,
  errorComponent: ({ error, reset }) => <ErrorState error={error} onRetry={reset} />,
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions());
    if (!session) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      });
    }
    return { session };
  },
});

function AuthLayout() {
  const { session } = Route.useRouteContext();

  return (
    <SidebarProvider>
      <AppSidebar user={session.user} />
      <SidebarInset className="min-h-svh">
        <AppTopbar />
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
