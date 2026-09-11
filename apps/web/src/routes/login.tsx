import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { LoginForm } from "@/components/login-form";
import { SignupForm } from "@/components/signup-form";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const search = Route.useSearch();
  const [showLogin, setShowLogin] = useState(true);
  const redirectTo = safeRedirect(search.redirect);

  return (
    <main className="flex min-h-svh w-full items-center justify-center bg-muted/40 p-6 md:p-10">
      {showLogin ? (
        <LoginForm
          className="w-full max-w-md"
          redirectTo={redirectTo}
          onSwitchToSignup={() => setShowLogin(false)}
        />
      ) : (
        <SignupForm
          className="w-full max-w-lg"
          redirectTo={redirectTo}
          onSwitchToLogin={() => setShowLogin(true)}
        />
      )}
    </main>
  );
}

function safeRedirect(redirectTo?: string) {
  return redirectTo?.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/dashboard";
}
