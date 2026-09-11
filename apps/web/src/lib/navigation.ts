import {
  ChartNoAxesCombinedIcon,
  DatabaseIcon,
  LayoutDashboardIcon,
  MapIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";

import type { NavigationSection } from "@/components/nav-main";

export type AppPath = "/dashboard" | "/datasets" | "/maps" | "/charts" | "/members" | "/settings";

export const appNavigation: NavigationSection[] = [
  {
    label: "Workspace",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboardIcon },
      { title: "Datasets", url: "/datasets", icon: DatabaseIcon },
      { title: "Maps", url: "/maps", icon: MapIcon },
      { title: "Charts", url: "/charts", icon: ChartNoAxesCombinedIcon },
    ],
  },
  {
    label: "Manage",
    items: [
      { title: "Members", url: "/members", icon: UsersIcon },
      { title: "Settings", url: "/settings", icon: SettingsIcon },
    ],
  },
];
