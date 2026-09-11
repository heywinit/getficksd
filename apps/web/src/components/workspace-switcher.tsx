import { Avatar, AvatarFallback, AvatarImage } from "@getficksd/ui/components/avatar";
import { Button } from "@getficksd/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@getficksd/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@getficksd/ui/components/dropdown-menu";
import { Input } from "@getficksd/ui/components/input";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@getficksd/ui/components/sidebar";
import { CheckIcon, ChevronsUpDownIcon, GalleryVerticalEndIcon, PlusIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export function WorkspaceSwitcher() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { isMobile, state } = useSidebar();
  const isCollapsed = !isMobile && state === "collapsed";
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const {
    data: workspaceData,
    isPending,
    refetch: refetchWorkspaces,
  } = authClient.useListOrganizations();
  const { data: activeWorkspace, refetch: refetchActiveWorkspace } =
    authClient.useActiveOrganization();
  const workspaces = workspaceData ?? [];
  const selectedWorkspace = activeWorkspace ?? workspaces[0];

  async function selectWorkspace(organizationId: string) {
    const response = await authClient.organization.setActive({ organizationId });

    if (response.error) {
      toast.error(response.error.message ?? "Workspace selection failed.");
      return;
    }

    await refreshWorkspaceData();
  }

  async function refreshWorkspaceData() {
    await Promise.all([
      refetchWorkspaces(),
      refetchActiveWorkspace(),
      queryClient.invalidateQueries(),
    ]);
    await router.invalidate();
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();

    if (trimmedName.length < 2) {
      toast.error("Enter a workspace name.");
      return;
    }

    setIsCreating(true);
    const slug = `${trimmedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")}-${crypto.randomUUID().slice(0, 6)}`;
    const response = await authClient.organization.create({
      name: trimmedName,
      slug,
    });
    setIsCreating(false);

    if (response.error) {
      toast.error(response.error.message ?? "Workspace creation failed.");
      return;
    }

    if (response.data?.id) {
      const activeResponse = await authClient.organization.setActive({
        organizationId: response.data.id,
      });
      if (activeResponse.error) {
        toast.error(activeResponse.error.message ?? "Workspace selection failed.");
        return;
      }
    }

    setName("");
    setCreateOpen(false);
    toast.success("Workspace created.");
    await refreshWorkspaceData();
  }

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={isPending || !selectedWorkspace}
              render={
                <SidebarMenuButton
                  size={isCollapsed ? "default" : "lg"}
                  tooltip={selectedWorkspace?.name ?? "Workspace"}
                  className="aria-expanded:bg-muted"
                />
              }
            >
              {isCollapsed ? (
                <GalleryVerticalEndIcon />
              ) : (
                <>
                  <Avatar className="rounded-none" size="sm">
                    <AvatarImage src={selectedWorkspace?.logo ?? undefined} alt="" />
                    <AvatarFallback className="rounded-none">
                      <GalleryVerticalEndIcon />
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">
                      {selectedWorkspace?.name ?? "Loading workspace"}
                    </span>
                    <span className="truncate text-xs">Workspace</span>
                  </div>
                  <ChevronsUpDownIcon className="ml-auto size-4" />
                </>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-64"
              side={isMobile ? "bottom" : "right"}
              align="start"
              sideOffset={4}
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {workspaces.map((workspace) => (
                  <DropdownMenuItem
                    key={workspace.id}
                    onClick={() => selectWorkspace(workspace.id)}
                  >
                    <GalleryVerticalEndIcon />
                    <span className="truncate">{workspace.name}</span>
                    {workspace.id === selectedWorkspace?.id ? (
                      <CheckIcon className="ml-auto" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setCreateOpen(true)}>
                <PlusIcon />
                Create workspace
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="p-5">
          <div>
            <DialogTitle>Create workspace</DialogTitle>
            <DialogDescription className="mt-1">
              Add another space for a project or team.
            </DialogDescription>
          </div>
          <form className="grid gap-3" onSubmit={createWorkspace}>
            <Input
              autoFocus
              placeholder="Workspace name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isCreating}>
                {isCreating ? "Creating..." : "Create workspace"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
