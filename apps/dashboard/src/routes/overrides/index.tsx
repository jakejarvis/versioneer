import { createFileRoute } from "@tanstack/react-router";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { useOverrides, useCreateOverride, useDeactivateOverride } from "@/api/hooks/use-overrides";
import type { OverrideListItem } from "@/api/types";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, type BulkAction } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
import { EntityReferenceLink } from "@/components/shared/entity-link";
import { JsonViewer } from "@/components/shared/json-viewer";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  applyPaginationToSearch,
  applySortingToSearch,
  paginatedSearchShape,
  paginationFromSearch,
  sortingFromSearch,
} from "@/lib/data-table-search";

const overridesSearchSchema = z.object({
  ...paginatedSearchShape,
  active: z.enum(["all", "active", "inactive"]).catch("all"),
});

export const Route = createFileRoute("/overrides/")({
  validateSearch: (search) => overridesSearchSchema.parse(search),
  component: OverridesPage,
});

function OverridesPage() {
  const navigate = Route.useNavigate();
  const searchState = Route.useSearch();
  const pagination = paginationFromSearch(searchState);
  const sorting = sortingFromSearch(searchState);
  const [createOpen, setCreateOpen] = useState(false);
  const [deactivateId, setDeactivateId] = useState<string | null>(null);
  const [viewPayload, setViewPayload] = useState<OverrideListItem | null>(null);
  const deactivate = useDeactivateOverride();

  const { data, isLoading } = useOverrides({
    active: searchState.active === "all" ? undefined : searchState.active === "active",
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    sortBy: searchState.sortBy,
    sortDir: searchState.sortDir,
  });

  const columns = useMemo<ColumnDef<OverrideListItem>[]>(
    () => [
      {
        accessorKey: "overrideType",
        meta: { label: "Type" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) => (
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
            {row.original.overrideType}
          </span>
        ),
      },
      {
        id: "targetRef",
        meta: { label: "Target" },
        enableSorting: false,
        cell: ({ row }) => <EntityReferenceLink refItem={row.original.targetRef} />,
      },
      {
        accessorKey: "reason",
        meta: { label: "Reason" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Reason" />,
        cell: ({ row }) => row.original.reason ?? "--",
      },
      {
        accessorKey: "createdBy",
        meta: { label: "Created By" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Created By" />,
        cell: ({ row }) => row.original.createdBy ?? "--",
      },
      {
        accessorKey: "isActive",
        meta: { label: "Active" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Active" />,
        cell: ({ row }) => <StatusBadge status={row.original.isActive ? "active" : "disabled"} />,
      },
      {
        accessorKey: "createdAt",
        meta: { label: "Created" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
        cell: ({ row }) => <TimeAgo date={row.original.createdAt} />,
      },
      {
        id: "actions",
        meta: { label: "Actions" },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setViewPayload(row.original)}>
              View
            </Button>
            {row.original.isActive ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => setDeactivateId(row.original.id)}
              >
                Deactivate
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [],
  );

  const bulkActions: BulkAction<OverrideListItem>[] = [
    {
      label: "Deactivate Selected",
      variant: "destructive",
      onClick: async (rows) => {
        for (const row of rows) {
          if (row.isActive) {
            deactivate.mutate(row.id, {
              onSuccess: () => toast.success("Override deactivated"),
              onError: (err) => toast.error(err.message),
            });
          }
        }
      },
    },
  ];

  const pageCount = data ? Math.max(1, Math.ceil(data.total / pagination.pageSize)) : 0;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Overrides</h2>
          <p className="mt-1 text-muted-foreground">
            Manual admin overrides for release selection and matching.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Override
        </Button>
      </div>

      <div className="mt-4">
        <div className="mb-4">
          <Select
            value={searchState.active}
            onValueChange={(value) =>
              void navigate({
                to: "/overrides",
                search: {
                  ...searchState,
                  page: 1,
                  active: value as typeof searchState.active,
                },
              })
            }
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All overrides</SelectItem>
              <SelectItem value="active">Active only</SelectItem>
              <SelectItem value="inactive">Inactive only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No overrides."
          sorting={sorting}
          onSortingChange={(updater: SortingState | ((prev: SortingState) => SortingState)) =>
            void navigate({
              to: "/overrides",
              search: applySortingToSearch(searchState, updater),
            })
          }
          manualSorting
          enableColumnVisibility
          enableRowSelection
          bulkActions={bulkActions}
          pagination={
            data
              ? {
                  total: data.total,
                  pageIndex: pagination.pageIndex,
                  pageSize: pagination.pageSize,
                  pageCount,
                  onPaginationChange: (updater) =>
                    void navigate({
                      to: "/overrides",
                      search: applyPaginationToSearch(searchState, updater),
                    }),
                }
              : undefined
          }
        />
      </div>

      <CreateOverrideDialog open={createOpen} onOpenChange={setCreateOpen} />

      <ConfirmDialog
        open={!!deactivateId}
        onOpenChange={(open) => !open && setDeactivateId(null)}
        title="Deactivate Override"
        description="This will deactivate the override. Latest release state may need to be recomputed."
        confirmLabel="Deactivate"
        variant="destructive"
        onConfirm={() => {
          if (deactivateId) {
            deactivate.mutate(deactivateId, {
              onSuccess: () => {
                toast.success("Override deactivated");
                setDeactivateId(null);
              },
              onError: (err) => toast.error(err.message),
            });
          }
        }}
        loading={deactivate.isPending}
      />

      <Dialog open={!!viewPayload} onOpenChange={(open) => !open && setViewPayload(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Override Payload</DialogTitle>
          </DialogHeader>
          {viewPayload && <JsonViewer data={viewPayload.payloadJson} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateOverrideDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [overrideType, setOverrideType] = useState("");
  const [targetType, setTargetType] = useState("");
  const [targetId, setTargetId] = useState("");
  const [payloadJson, setPayloadJson] = useState("{}");
  const [reason, setReason] = useState("");
  const createOverride = useCreateOverride();

  const handleSubmit = () => {
    createOverride.mutate(
      {
        overrideType,
        targetType,
        targetId,
        payloadJson,
        reason: reason || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Override created");
          onOpenChange(false);
          setOverrideType("");
          setTargetType("");
          setTargetId("");
          setPayloadJson("{}");
          setReason("");
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Override</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Override Type</Label>
            <Input
              placeholder="app_latest"
              value={overrideType}
              onChange={(e) => setOverrideType(e.target.value)}
            />
          </div>
          <div>
            <Label>Target Type</Label>
            <Input
              placeholder="app"
              value={targetType}
              onChange={(e) => setTargetType(e.target.value)}
            />
          </div>
          <div>
            <Label>Target ID</Label>
            <Input
              placeholder="app_abc123"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            />
          </div>
          <div>
            <Label>Payload JSON</Label>
            <Textarea
              className="font-mono text-sm"
              rows={4}
              value={payloadJson}
              onChange={(e) => setPayloadJson(e.target.value)}
            />
          </div>
          <div>
            <Label>Reason</Label>
            <Input
              placeholder="Why this override?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!overrideType || !targetType || !targetId || createOverride.isPending}
          >
            {createOverride.isPending ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
