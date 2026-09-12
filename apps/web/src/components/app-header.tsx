import { Button } from "@getficksd/ui/components/button";
import { Link } from "@tanstack/react-router";
import { CloudSunIcon, GaugeIcon, LayoutDashboardIcon, MapIcon, ZapIcon } from "lucide-react";
import type { ReactNode } from "react";

type AppHeaderProps = {
  siteId?: string;
  siteName?: string;
  location?: string;
  trailing?: ReactNode;
};

export function AppHeader({ siteId, siteName, location, trailing }: AppHeaderProps) {
  return (
    <header className="z-30 shrink-0 border-b border-border bg-card/95 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-[1600px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"
          to="/"
          aria-label="Wattson home"
        >
          <ZapIcon className="size-4" />
        </Link>
        <div className="min-w-0 sm:mr-2">
          <p className="truncate text-sm font-semibold tracking-tight">{siteName ?? "Wattson"}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {location ?? "Community energy operations"}
          </p>
        </div>

        <nav
          className="ml-auto flex min-w-0 items-center gap-0.5 overflow-x-auto"
          aria-label="Main navigation"
        >
          <HeaderLink to="/" label="Sites" icon={MapIcon} />
          {siteId ? (
            <>
              <HeaderLink
                to="/sites/$siteId"
                params={{ siteId }}
                label="Overview"
                icon={LayoutDashboardIcon}
              />
              <HeaderLink
                to="/sites/$siteId/operate"
                params={{ siteId }}
                label="Operations"
                icon={GaugeIcon}
              />
              <HeaderLink
                to="/sites/$siteId/forecast"
                params={{ siteId }}
                label="Forecast"
                icon={CloudSunIcon}
              />
            </>
          ) : null}
        </nav>
        {trailing ? <div className="hidden shrink-0 lg:block">{trailing}</div> : null}
      </div>
    </header>
  );
}

type HeaderLinkProps = {
  to: string;
  params?: { siteId: string };
  label: string;
  icon: typeof MapIcon;
};

function HeaderLink({ to, params, label, icon: Icon }: HeaderLinkProps) {
  return (
    <Button
      render={
        <Link
          to={to}
          params={params}
          activeOptions={{ exact: true }}
          activeProps={{ "data-active": true }}
        />
      }
      variant="ghost"
      className="text-muted-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground"
      size="sm"
    >
      <Icon />
      <span className="hidden md:inline">{label}</span>
    </Button>
  );
}
