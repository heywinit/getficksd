"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@getficksd/ui/components/sidebar";
import { Link } from "@tanstack/react-router";
import { ZapIcon } from "lucide-react";
import type * as React from "react";

import { NavMain, type NavigationSection } from "@/components/nav-main";
import { OperatorSwitcher } from "@/components/operator-switcher";
import { appNavigation } from "@/lib/navigation";

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  navigation?: NavigationSection[];
};

export function AppSidebar({ navigation = appNavigation, ...props }: AppSidebarProps) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/" />} tooltip="Wattson">
              <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
                <ZapIcon className="size-4" />
              </span>
              <span className="font-semibold tracking-tight">Wattson</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <OperatorSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavMain sections={navigation} />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
