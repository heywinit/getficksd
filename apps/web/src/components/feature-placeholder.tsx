import { Card, CardContent, CardHeader, CardTitle } from "@getficksd/ui/components/card";
import type { LucideIcon } from "lucide-react";

type FeaturePlaceholderProps = {
  title: string;
  description: string;
  icon: LucideIcon;
};

export function FeaturePlaceholder({ title, description, icon: Icon }: FeaturePlaceholderProps) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-lg border-dashed">
        <CardHeader>
          <div className="mb-3 flex size-10 items-center justify-center border bg-muted">
            <Icon className="size-5" />
          </div>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </div>
  );
}
