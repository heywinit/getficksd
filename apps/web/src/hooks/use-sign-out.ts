import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { sessionQueryKey } from "@/functions/get-user";

export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isPending, setIsPending] = useState(false);

  async function signOut() {
    if (isPending) return;

    setIsPending(true);

    try {
      const response = await authClient.signOut();

      if (response.error) {
        toast.error(response.error.message ?? "Sign out failed.");
        return;
      }

      queryClient.setQueryData(sessionQueryKey, null);
      await navigate({ to: "/", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign out failed.");
    } finally {
      setIsPending(false);
    }
  }

  return { isPending, signOut };
}
