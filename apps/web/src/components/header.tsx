import { Button } from "@getficksd/ui/components/button";
import { Link } from "@tanstack/react-router";

import UserMenu from "./user-menu";

export default function Header() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link className="flex items-center gap-2 font-semibold tracking-tight" to="/">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-xs text-primary-foreground">
            G
          </span>
          getficksd
        </Link>
        <nav className="flex items-center gap-2">
          <Button variant="ghost" render={<Link to="/dashboard" preload="intent" />}>
            Dashboard
          </Button>
          <UserMenu />
        </nav>
      </div>
    </header>
  );
}
