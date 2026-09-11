"use client";

import { Avatar, AvatarFallback } from "@getficksd/ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@getficksd/ui/components/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@getficksd/ui/components/sidebar";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";

import { useDemoWorkspace } from "@/lib/demo-workspace";

export function OperatorSwitcher() {
  const { error, isLoading, operator, operators, selectOperator } = useDemoWorkspace();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={isLoading || !operator}
            render={
              <SidebarMenuButton
                size="lg"
                tooltip={operator?.name ?? (error ? "Operators unavailable" : "Loading operators")}
                className="aria-expanded:bg-muted"
              />
            }
          >
            <Avatar className="rounded-md" size="sm">
              <AvatarFallback className="rounded-md">
                {operator ? initials(operator.name) : "…"}
              </AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{operator?.name ?? "Loading operator"}</span>
              <span className="truncate text-xs text-muted-foreground">
                {operator?.site.name ?? error ?? "Seeded demo account"}
              </span>
            </div>
            <ChevronsUpDownIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-72" side="right" align="start" sideOffset={4}>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Demo operators</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {operators.map((item) => (
                <DropdownMenuItem key={item.id} onClick={() => selectOperator(item.id)}>
                  <Avatar className="rounded-md" size="sm">
                    <AvatarFallback className="rounded-md">{initials(item.name)}</AvatarFallback>
                  </Avatar>
                  <div className="grid min-w-0 flex-1">
                    <span className="truncate font-medium">{item.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{item.site.name}</span>
                  </div>
                  {item.id === operator?.id ? <CheckIcon className="ml-auto size-4" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
