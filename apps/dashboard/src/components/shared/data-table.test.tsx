import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { DataTable } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";

interface RowData {
  id: string;
  name: string;
}

const rows: RowData[] = [
  { id: "row_1", name: "Alpha" },
  { id: "row_2", name: "Bravo" },
];

const basicColumns = [
  {
    key: "name",
    header: "Name",
    cell: (row: RowData) => row.name,
  },
];

const sortableColumns: ColumnDef<RowData>[] = [
  {
    accessorKey: "name",
    meta: { label: "Name" },
    header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
    cell: ({ row }) => row.original.name,
  },
];

function ControlledTable({
  onBulkAction,
}: {
  onBulkAction: (selectedRows: RowData[]) => void | Promise<void>;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);

  return (
    <div>
      <div data-testid="sorting-state">
        {sorting[0] ? `${sorting[0].id}:${sorting[0].desc ? "desc" : "asc"}` : "none"}
      </div>
      <DataTable
        columns={sortableColumns}
        data={rows}
        getRowId={(row) => row.id}
        sorting={sorting}
        onSortingChange={setSorting}
        manualSorting
        enableRowSelection
        bulkActions={[
          {
            label: "Bulk Action",
            onClick: onBulkAction,
          },
        ]}
      />
    </div>
  );
}

describe("DataTable", () => {
  it("renders loading state without empty messaging", () => {
    render(<DataTable columns={basicColumns} data={[]} isLoading emptyMessage="No rows." />);

    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.queryByText("No rows.")).not.toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(6);
  });

  it("renders the configured empty state", () => {
    render(<DataTable columns={basicColumns} data={[]} emptyMessage="No rows." />);

    expect(screen.getByText("No rows.")).toBeInTheDocument();
  });

  it("supports controlled manual sorting and clears selection when sort state changes", async () => {
    const bulkAction = vi.fn();

    render(<ControlledTable onBulkAction={bulkAction} />);

    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    expect(screen.getByText("1 row selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /name/i }));

    expect(screen.getByTestId("sorting-state")).toHaveTextContent("name:asc");
    await waitFor(() => {
      expect(screen.queryByText("1 row selected")).not.toBeInTheDocument();
    });
  });

  it("enables bulk actions for selected rows and clears selection after invoking them", async () => {
    const bulkAction = vi.fn();

    render(<ControlledTable onBulkAction={bulkAction} />);

    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Bulk Action" }));

    await waitFor(() => {
      expect(bulkAction).toHaveBeenCalledWith([rows[0]]);
    });
    expect(screen.queryByText("1 row selected")).not.toBeInTheDocument();
  });
});
