import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { useDebouncedSearchInput } from "./data-table-search";

function DebouncedSearchHarness({
  initialValue = "",
  onCommit,
}: {
  initialValue?: string;
  onCommit: (value: string) => void;
}) {
  const [routeValue, setRouteValue] = useState(initialValue);
  const [draftValue, setDraftValue] = useDebouncedSearchInput({
    value: routeValue,
    delayMs: 300,
    onCommit: (value) => {
      onCommit(value);
      setRouteValue(value);
    },
  });

  return (
    <div>
      <input
        aria-label="Search rows"
        value={draftValue}
        onChange={(event) => setDraftValue(event.target.value)}
      />
      <span data-testid="route-value">{routeValue}</span>
    </div>
  );
}

describe("useDebouncedSearchInput", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("updates the input immediately and commits the route value once typing settles", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn<(value: string) => void>();

    render(<DebouncedSearchHarness onCommit={onCommit} />);

    const input = screen.getByRole("textbox", { name: "Search rows" });
    fireEvent.change(input, { target: { value: "v" } });
    fireEvent.change(input, { target: { value: "vi" } });
    fireEvent.change(input, { target: { value: "vim" } });

    expect(input).toHaveValue("vim");
    expect(screen.getByTestId("route-value")).toHaveTextContent("");
    expect(onCommit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(299);
    });

    expect(onCommit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith("vim");
    expect(screen.getByTestId("route-value")).toHaveTextContent("vim");
  });
});
