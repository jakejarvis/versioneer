import { Link, useRouterState } from "@tanstack/react-router";

import { useAuth } from "@/api/hooks/use-auth";
import { navItems } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const { data: user } = useAuth();

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-border bg-sidebar">
      <div className="flex h-14 items-center border-b border-border px-4">
        <h1 className="text-lg font-semibold tracking-tight text-sidebar-foreground">Versioneer</h1>
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive =
              item.path === "/" ? currentPath === "/" : currentPath.startsWith(item.path);
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
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
      {user && (
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2 text-sm text-sidebar-foreground/70">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-medium">
              {user.email[0]?.toUpperCase() ?? "?"}
            </div>
            <span className="truncate">{user.email}</span>
          </div>
        </div>
      )}
    </aside>
  );
}
