import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useOverrides, useCreateOverride, useDeactivateOverride } from "@/api/hooks/use-overrides";
import type { Override } from "@/api/types";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, type Column } from "@/components/shared/data-table";
import { IdDisplay } from "@/components/shared/id-display";
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
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/overrides/")({
  component: OverridesPage,
});

function OverridesPage() {
  const [offset, setOffset] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [deactivateId, setDeactivateId] = useState<string | null>(null);
  const [viewPayload, setViewPayload] = useState<Override | null>(null);
  const deactivate = useDeactivateOverride();

  const { data, isLoading } = useOverrides({ limit: 50, offset });

  const columns: Column<Override>[] = [
    {
      key: "overrideType",
      header: "Type",
      cell: (row) => (
        <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{row.overrideType}</span>
      ),
    },
    {
      key: "targetType",
      header: "Target",
      cell: (row) => (
        <span className="text-sm">
          {row.targetType}: <IdDisplay id={row.targetId} />
        </span>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      cell: (row) => row.reason ?? "--",
    },
    {
      key: "createdBy",
      header: "Created By",
      cell: (row) => row.createdBy ?? "--",
    },
    {
      key: "isActive",
      header: "Active",
      cell: (row) => <StatusBadge status={row.isActive ? "active" : "disabled"} />,
    },
    {
      key: "createdAt",
      header: "Created",
      cell: (row) => <TimeAgo date={row.createdAt} />,
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setViewPayload(row);
            }}
          >
            View
          </Button>
          {row.isActive && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                setDeactivateId(row.id);
              }}
            >
              Deactivate
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Overrides</h2>
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
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No overrides."
          pagination={
            data
              ? {
                  total: data.total,
                  limit: data.limit,
                  offset: data.offset,
                  onOffsetChange: setOffset,
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
