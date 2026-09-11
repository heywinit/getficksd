import { Avatar, AvatarFallback, AvatarImage } from "@getficksd/ui/components/avatar";
import { Button } from "@getficksd/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@getficksd/ui/components/card";
import { Input } from "@getficksd/ui/components/input";
import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

const roles = ["owner", "admin", "member"] as const;

export const Route = createFileRoute("/_auth/members")({
  validateSearch: (search: Record<string, unknown>) => ({
    invitation: typeof search.invitation === "string" ? search.invitation : undefined,
  }),
  component: MembersPage,
});

function MembersPage() {
  const { invitation } = Route.useSearch();
  const { data: workspace, refetch } = authClient.useActiveOrganization();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof roles)[number]>("member");
  const [isInviting, setIsInviting] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);

  async function acceptInvitation() {
    if (!invitation) return;

    setIsAccepting(true);
    const response = await authClient.organization.acceptInvitation({ invitationId: invitation });
    setIsAccepting(false);

    if (response.error) {
      toast.error(response.error.message ?? "Could not accept the invitation.");
      return;
    }

    toast.success("Invitation accepted.");
    window.location.assign("/members");
  }

  async function inviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !email.trim()) {
      return;
    }

    setIsInviting(true);
    const response = await authClient.organization.inviteMember({
      email: email.trim(),
      role,
      organizationId: workspace.id,
    });
    setIsInviting(false);

    if (response.error) {
      toast.error(response.error.message ?? "Invitation failed.");
      return;
    }

    setEmail("");
    toast.success("Invitation created.");
    await refetch();
  }

  async function updateRole(memberId: string, nextRole: (typeof roles)[number]) {
    const response = await authClient.organization.updateMemberRole({
      memberId,
      role: nextRole,
      organizationId: workspace?.id,
    });

    if (response.error) {
      toast.error(response.error.message ?? "Role update failed.");
      return;
    }

    toast.success("Role updated.");
    await refetch();
  }

  return (
    <div className="flex w-full max-w-4xl flex-col gap-6 p-6">
      {invitation ? (
        <Card>
          <CardHeader>
            <CardTitle>Workspace invitation</CardTitle>
            <CardDescription>Accept this invitation to join the workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" disabled={isAccepting} onClick={acceptInvitation}>
              {isAccepting ? "Accepting..." : "Accept invitation"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Invite a member</CardTitle>
          <CardDescription>
            Add a person to {workspace?.name ?? "the active workspace"}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={inviteMember}>
            <Input
              type="email"
              placeholder="teammate@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <select
              className="h-8 border border-input bg-background px-2.5 text-xs"
              value={role}
              onChange={(event) => setRole(event.target.value as typeof role)}
            >
              {roles.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={isInviting || !workspace}>
              {isInviting ? "Inviting..." : "Invite"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>{workspace?.members.length ?? 0} people</CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {workspace?.members.map((member) => {
            const initials = member.user.name
              .split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();

            return (
              <div key={member.id} className="flex items-center gap-3 px-6 py-3">
                <Avatar>
                  <AvatarImage src={member.user.image} alt="" />
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{member.user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{member.user.email}</p>
                </div>
                <select
                  className="h-8 border border-input bg-background px-2.5 text-xs capitalize"
                  value={member.role}
                  onChange={(event) =>
                    updateRole(member.id, event.target.value as (typeof roles)[number])
                  }
                >
                  {roles.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
