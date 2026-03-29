import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { LogOut } from "lucide-react";

import { useAuth } from "@/api/hooks/use-auth";
import { useStats } from "@/api/hooks/use-stats";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarRail,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { navItems } from "@/lib/constants";

import { Button } from "../ui/button";

export function AppSidebar() {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const navigate = useNavigate();
  const { data: user } = useAuth();
  const { data: stats } = useStats();

  const displayName = user?.name || user?.email;
  const avatarLetter = (user?.name?.[0] || user?.email?.[0])?.toUpperCase() ?? "?";

  const badgeCounts: Record<string, number | undefined> = {
    "/discovered-apps": stats?.pendingDiscoveredApps,
    "/review": stats?.pendingCatalogSuggestions,
    "/sources": stats?.errorSources,
    "/jobs": stats?.openFailures,
    "/feedback": stats?.pendingFeedback,
  };

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border px-4 py-3">
        <h1 className="text-base font-semibold tracking-tight">Versioneer</h1>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive =
                  item.path === "/" ? currentPath === "/" : currentPath.startsWith(item.path);
                const count = badgeCounts[item.path];
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
                      <Link to={item.path}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {count ? <SidebarMenuBadge>{count}</SidebarMenuBadge> : null}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2 text-[13px] text-sidebar-foreground/60">
            {user && (
              <>
                <Avatar>
                  <AvatarImage src={user.image ?? undefined} alt={displayName} />
                  <AvatarFallback>{avatarLetter}</AvatarFallback>
                </Avatar>
                <span className="truncate">{displayName}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon-sm"
              className="hover:text-destructive-foreground"
              onClick={async () => {
                await authClient.signOut();
                navigate({ to: "/login" });
              }}
            >
              <LogOut />
              <span className="sr-only">Sign out</span>
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
