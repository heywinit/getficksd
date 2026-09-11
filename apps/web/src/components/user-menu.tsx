import { Avatar, AvatarFallback, AvatarImage } from "@getficksd/ui/components/avatar";
import { Button } from "@getficksd/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@getficksd/ui/components/dropdown-menu";
import { Link } from "@tanstack/react-router";
import { LogInIcon, LogOutIcon, UserIcon } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { useSignOut } from "@/hooks/use-sign-out";

export default function UserMenu() {
  const { data: session, isPending } = authClient.useSession();
  const { isPending: isSigningOut, signOut } = useSignOut();

  if (isPending) {
    return <div className="size-8 animate-pulse bg-muted" />;
  }

  if (!session) {
    return (
      <Button render={<Link to="/login" search={{ redirect: undefined }} />} variant="outline">
        <LogInIcon data-icon="inline-start" />
        Sign in
      </Button>
    );
  }

  const initials = session.user.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label="Open user menu" />}
      >
        <Avatar size="sm">
          <AvatarImage src={session.user.image ?? undefined} alt="" />
          <AvatarFallback>{initials || <UserIcon />}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="block truncate text-foreground">{session.user.name}</span>
            <span className="block truncate font-normal">{session.user.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={isSigningOut} onClick={() => void signOut()}>
          <LogOutIcon />
          {isSigningOut ? "Signing out..." : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
