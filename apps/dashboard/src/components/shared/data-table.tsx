import {
  type ColumnDef,
  type PaginationState,
  type Row,
  type RowSelectionState,
  type SortingState,
  type Table as TableInstance,
  type Updater,
  type VisibilityState,
  flexRender,
  functionalUpdate,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Inbox, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { Empty, EmptyHeader, EmptyMedia, EmptyDescription } from "@/components/ui/empty";
import { PaginationControls } from "./pagination-controls";

export interface Column<T> {
  header: string;
  key: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
}

export interface BulkAction<TData> {
  label: string;
  onClick: (rows: TData[]) => void | Promise<void>;
  variant?: React.ComponentProps<typeof Button>["variant"];
  disabled?: boolean;
}

interface DataTablePaginationProps {
  total: number;
  pageIndex: number;
  pageSize: number;
  pageCount: number;
  onPaginationChange: (updater: Updater<PaginationState>) => void;
}

interface LegacyPaginationProps {
  total: number;
  limit: number;
  offset: number;
  onOffsetChange: (offset: number) => void;
}

interface DataTableProps<T> {
  columns: Array<ColumnDef<T, unknown> | Column<T>>;
  data: T[];
  getRowId?: (row: T, index: number) => string;
  rowKey?: (row: T, index: number) => string;
  isLoading?: boolean;
  emptyMessage?: string;
  pagination?: DataTablePaginationProps | LegacyPaginationProps;
  sorting?: SortingState;
  onSortingChange?: (updater: Updater<SortingState>) => void;
  manualSorting?: boolean;
  enableRowSelection?: boolean | ((row: Row<T>) => boolean);
  bulkActions?: BulkAction<T>[];
  toolbar?: React.ReactNode;
  enableColumnVisibility?: boolean;
  initialColumnVisibility?: VisibilityState;
  noResultsMessage?: string;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({
  columns,
  data,
  getRowId,
  rowKey,
  isLoading,
  emptyMessage,
  pagination,
  sorting,
  onSortingChange,
  manualSorting,
  enableRowSelection,
  bulkActions,
  toolbar,
  enableColumnVisibility,
  initialColumnVisibility,
  noResultsMessage,
  onRowClick,
}: DataTableProps<T>) {
  const [internalSorting, setInternalSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    initialColumnVisibility ?? {},
  );
  const resolvedSorting = sorting ?? internalSorting;
  const resolvedOnSortingChange = onSortingChange ?? setInternalSorting;

  const resolvedGetRowId = getRowId ?? rowKey;

  const selectionColumn = useMemo<ColumnDef<T>[]>(() => {
    if (!enableRowSelection) {
      return [];
    }

    return [
      {
        id: "_select",
        enableSorting: false,
        enableHiding: false,
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all rows"
            checked={
              table.getIsAllPageRowsSelected()
                ? true
                : table.getIsSomePageRowsSelected()
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(Boolean(value))}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label="Select row"
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            onCheckedChange={(value) => row.toggleSelected(Boolean(value))}
            onClick={(event) => event.stopPropagation()}
          />
        ),
        size: 36,
      },
    ];
  }, [enableRowSelection]);

  const normalizedColumns = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((column) => {
        if ("key" in column) {
          return {
            id: column.key,
            accessorKey: column.key,
            header: column.header,
            cell: ({ row }) => <div className={column.className}>{column.cell(row.original)}</div>,
            meta: { label: column.header },
          } satisfies ColumnDef<T>;
        }

        return column;
      }),
    [columns],
  );

  const resolvedPagination = useMemo<DataTablePaginationProps | undefined>(() => {
    if (!pagination) {
      return undefined;
    }

    if ("pageIndex" in pagination) {
      return pagination;
    }

    return {
      total: pagination.total,
      pageIndex: Math.floor(pagination.offset / pagination.limit),
      pageSize: pagination.limit,
      pageCount: Math.max(1, Math.ceil(pagination.total / pagination.limit)),
      onPaginationChange: (updater) => {
        const current = {
          pageIndex: Math.floor(pagination.offset / pagination.limit),
          pageSize: pagination.limit,
        };
        const next = functionalUpdate(updater, current);
        pagination.onOffsetChange(next.pageIndex * next.pageSize);
      },
    };
  }, [pagination]);

  const table = useReactTable({
    data,
    columns: [...selectionColumn, ...normalizedColumns],
    getRowId: resolvedGetRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    manualSorting,
    manualPagination: Boolean(resolvedPagination),
    pageCount: resolvedPagination?.pageCount,
    enableRowSelection,
    state: {
      sorting: resolvedSorting,
      rowSelection,
      columnVisibility,
      pagination: resolvedPagination
        ? {
            pageIndex: resolvedPagination.pageIndex,
            pageSize: resolvedPagination.pageSize,
          }
        : undefined,
    },
    onSortingChange: resolvedOnSortingChange,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: resolvedPagination?.onPaginationChange,
  });

  useEffect(() => {
    setRowSelection({});
  }, [data, resolvedSorting, resolvedPagination?.pageIndex, resolvedPagination?.pageSize]);

  const selectedRows = table.getSelectedRowModel().rows.map((row) => row.original);

  const handleBulkAction = async (action: BulkAction<T>) => {
    await action.onClick(selectedRows);
    setRowSelection({});
  };

  const renderTable = (tableInstance: TableInstance<T>) => (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          {tableInstance.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {tableInstance.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              data-state={row.getIsSelected() ? "selected" : undefined}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              className={cn(
                "transition-colors",
                onRowClick ? "cursor-pointer hover:bg-muted/50" : undefined,
              )}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {table.getAllLeafColumns().map((column) => (
                  <TableHead key={column.id}>
                    {typeof column.columnDef.header === "string" ? column.columnDef.header : null}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* oxlint-disable react/no-array-index-key -- static skeleton placeholders */}
              {Array.from({ length: 5 }).map((_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`}>
                  {table.getAllLeafColumns().map((column) => (
                    <TableCell key={column.id}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {/* oxlint-enable react/no-array-index-key */}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">{toolbar}</div>
        {enableColumnVisibility && table.getAllLeafColumns().length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Settings2 />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table
                .getAllLeafColumns()
                .filter((column) => column.getCanHide())
                .map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    className="capitalize"
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) => column.toggleVisibility(Boolean(value))}
                  >
                    {typeof column.columnDef.meta === "object" &&
                    column.columnDef.meta &&
                    "label" in column.columnDef.meta
                      ? String(column.columnDef.meta.label)
                      : column.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {selectedRows.length > 0 && bulkActions && bulkActions.length > 0 && (
        <div className="flex flex-col gap-3 rounded-md border bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {selectedRows.length} row{selectedRows.length === 1 ? "" : "s"} selected
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {bulkActions.map((action) => (
              <Button
                key={action.label}
                size="sm"
                variant={action.variant ?? "outline"}
                disabled={action.disabled}
                onClick={() => void handleBulkAction(action)}
              >
                {action.label}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setRowSelection({})}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {table.getRowModel().rows.length > 0 ? (
        renderTable(table)
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyDescription>{noResultsMessage ?? emptyMessage}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {resolvedPagination && (
        <PaginationControls
          total={resolvedPagination.total}
          pageIndex={resolvedPagination.pageIndex}
          pageSize={resolvedPagination.pageSize}
          pageCount={resolvedPagination.pageCount}
          onPageIndexChange={(pageIndex) =>
            resolvedPagination.onPaginationChange((prev) => ({ ...prev, pageIndex }))
          }
          onPageSizeChange={(pageSize) =>
            resolvedPagination.onPaginationChange((prev) => ({ ...prev, pageIndex: 0, pageSize }))
          }
        />
      )}
    </div>
  );
}
