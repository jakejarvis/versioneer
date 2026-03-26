import { Link, useRouterState } from "@tanstack/react-router";

import { useAuth } from "@/api/hooks/use-auth";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { navItems } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const { data: user } = useAuth();

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-border bg-sidebar">
      <div className="flex h-14 items-center border-b border-border px-4">
        <h1 className="text-base font-semibold tracking-tight text-sidebar-foreground">
          Versioneer
        </h1>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const isActive =
              item.path === "/" ? currentPath === "/" : currentPath.startsWith(item.path);
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-border p-2.5">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2 text-[13px] text-sidebar-foreground/60">
            {user && (
              <>
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-[11px] font-medium text-sidebar-accent-foreground">
                  {user.email[0]?.toUpperCase() ?? "?"}
                </div>
                <span className="truncate">{user.email}</span>
              </>
            )}
          </div>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
