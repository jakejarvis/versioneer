import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { DashboardRouteError } from "@/components/shared/dashboard-route-error";
import { captureDashboardException } from "@/lib/posthog";

vi.mock("@/lib/posthog", () => ({
  captureDashboardException:
    vi.fn<(error: unknown, properties?: Record<string, unknown>) => void>(),
}));

describe("DashboardRouteError", () => {
  it("shows the error message and recovery actions", () => {
    const error = new Error("Initial load failed");

    render(<DashboardRouteError error={error} reset={vi.fn<() => void>()} />);

    expect(screen.getByText("Dashboard view failed")).toBeInTheDocument();
    expect(screen.getByText("Initial load failed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to dashboard/i })).toHaveAttribute("href", "/");
    expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();
    expect(captureDashboardException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        component: "dashboard_route_error",
      }),
    );
  });
});
