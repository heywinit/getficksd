import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@getficksd/ui/components/sidebar";
import { Link, useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";

import type { AppPath } from "@/lib/navigation";

export type NavigationSection = {
  label: string;
  items: Array<{
    title: string;
    url: AppPath;
    icon: LucideIcon;
  }>;
};

export function NavMain({ sections }: { sections: NavigationSection[] }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return sections.map((section) => (
    <SidebarGroup key={section.label}>
      <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
      <SidebarMenu>
        {section.items.map((item) => (
          <SidebarMenuItem key={item.url}>
            <SidebarMenuButton
              render={
                <Link
                  to={item.url}
                  preload="intent"
                  onClick={() => {
                    if (isMobile) setOpenMobile(false);
                  }}
                />
              }
              tooltip={item.title}
              isActive={pathname === item.url}
            >
              <item.icon />
              <span>{item.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  ));
}
