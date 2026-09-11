import { LayoutDashboardIcon } from "lucide-react";

import type { NavigationSection } from "@/components/nav-main";

export type AppPath = "/dashboard";

export const appNavigation: NavigationSection[] = [
  {
    label: "Wattson",
    items: [{ title: "Dashboard", url: "/dashboard", icon: LayoutDashboardIcon }],
  },
];
