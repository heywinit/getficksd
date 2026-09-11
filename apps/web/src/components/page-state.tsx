import { Button } from "@getficksd/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@getficksd/ui/components/empty";
import { Skeleton } from "@getficksd/ui/components/skeleton";
import { AlertTriangleIcon, InboxIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type LoadingStateProps = {
  label?: string;
  rows?: number;
};

export function LoadingState({ label = "Loading...", rows = 3 }: LoadingStateProps) {
  return (
    <div className="w-full space-y-3 p-6" role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <Skeleton className="h-5 w-40" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
    </div>
  );
}

type EmptyStateProps = {
  title: string;
  description: string;
  icon?: LucideIcon;
  action?: ReactNode;
};

export function EmptyState({
  title,
  description,
  icon: Icon = InboxIcon,
  action,
}: EmptyStateProps) {
  return (
    <Empty className="border-0 py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

type ErrorStateProps = {
  error: unknown;
  onRetry?: () => void;
};

export function ErrorState({ error, onRetry }: ErrorStateProps) {
  const message = error instanceof Error ? error.message : "Something went wrong.";

  return (
    <div className="flex min-h-80 w-full items-center justify-center p-6" role="alert">
      <Empty className="max-w-lg border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertTriangleIcon />
          </EmptyMedia>
          <EmptyTitle>Could not load this page</EmptyTitle>
          <EmptyDescription>{message}</EmptyDescription>
        </EmptyHeader>
        {onRetry ? (
          <EmptyContent>
            <Button type="button" onClick={onRetry}>
              Try again
            </Button>
          </EmptyContent>
        ) : null}
      </Empty>
    </div>
  );
}
