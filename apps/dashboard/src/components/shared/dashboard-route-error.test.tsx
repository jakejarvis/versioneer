import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { DashboardRouteError } from "@/components/shared/dashboard-route-error";

describe("DashboardRouteError", () => {
  it("shows the error message and recovery actions", () => {
    render(
      <DashboardRouteError error={new Error("Initial load failed")} reset={vi.fn<() => void>()} />,
    );

    expect(screen.getByText("Dashboard view failed")).toBeInTheDocument();
    expect(screen.getByText("Initial load failed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to dashboard/i })).toHaveAttribute("href", "/");
    expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();
  });
});
