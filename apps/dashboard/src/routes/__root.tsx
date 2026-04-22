import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Toaster } from "sonner";

import { AppSidebar } from "@/components/layout/sidebar";
import { DashboardRouteError } from "@/components/shared/dashboard-route-error";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { DashboardPostHogIdentity, DashboardPostHogProvider } from "@/lib/posthog";
import { ThemeProvider, themeInitScript } from "@/lib/theme";
import { getSession } from "@/server/auth";

import appCss from "@/app.css?url";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      throwOnError: (_error, query) => query.state.data === undefined,
    },
  },
});

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    if (location.pathname === "/login" || location.pathname.startsWith("/api/auth")) {
      return;
    }
    const session = await getSession();
    if (!session) {
      throw redirect({ to: "/login" });
    }
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0" },
      { title: "Versioneer Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  component: RootComponent,
  errorComponent: DashboardRouteError,
});

function AppShell() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 md:hidden">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/versioneer.png" alt="Versioneer" className="rounded-sm size-5" />
            <span className="text-base font-mono font-semibold">Versioneer</span>
          </Link>
        </header>
        <div className="px-4 py-4 sm:px-6 sm:py-5">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function RootComponent() {
  const { pathname } = useRouterState({ select: (s) => s.location });
  const isLoginPage = pathname === "/login";

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="antialiased">
        <DashboardPostHogProvider>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider>
              {isLoginPage ? null : <DashboardPostHogIdentity />}
              {isLoginPage ? <Outlet /> : <AppShell />}
              <Toaster position="bottom-right" richColors theme="dark" />
            </ThemeProvider>
            <ReactQueryDevtools />
          </QueryClientProvider>
        </DashboardPostHogProvider>
        <TanStackRouterDevtools />
        <Scripts />
      </body>
    </html>
  );
}
