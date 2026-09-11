import { Button } from "@getficksd/ui/components/button";
import { Link } from "@tanstack/react-router";
import { ZapIcon } from "lucide-react";

export default function Header() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link className="flex items-center gap-2 font-semibold tracking-tight" to="/">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ZapIcon className="size-4" />
          </span>
          Wattson
        </Link>
        <nav className="flex items-center gap-2">
          <Button variant="ghost" render={<Link to="/dashboard" preload="intent" />}>
            Demo workspace
          </Button>
        </nav>
      </div>
    </header>
  );
}
