import { Button } from "@getficksd/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@getficksd/ui/components/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@getficksd/ui/components/field";
import { Input } from "@getficksd/ui/components/input";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_auth/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { data: workspace } = authClient.useActiveOrganization();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (workspace) {
      setName(workspace.name);
      setSlug(workspace.slug);
    }
  }, [workspace]);

  async function saveWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = name.trim();
    const normalizedSlug = slug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/(^-|-$)/g, "");

    if (!workspace || normalizedName.length < 2 || normalizedSlug.length < 2) {
      setError("Enter a valid workspace name and slug.");
      return;
    }

    setError(undefined);
    setIsSaving(true);
    const response = await authClient.organization.update({
      organizationId: workspace.id,
      data: { name: normalizedName, slug: normalizedSlug },
    });
    setIsSaving(false);

    if (response.error) {
      const message = response.error.message ?? "Workspace update failed.";
      setError(message);
      toast.error(message);
      return;
    }

    toast.success("Workspace updated.");
  }

  return (
    <div className="w-full max-w-2xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>Workspace settings</CardTitle>
          <CardDescription>
            Change the visible name and URL slug for the active workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveWorkspace}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="workspace-name">Name</FieldLabel>
                <Input
                  id="workspace-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="workspace-slug">Slug</FieldLabel>
                <Input
                  id="workspace-slug"
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                />
              </Field>
              {error ? <FieldError>{error}</FieldError> : null}
              <Button className="w-fit" type="submit" disabled={isSaving || !workspace}>
                {isSaving ? "Saving..." : "Save changes"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
