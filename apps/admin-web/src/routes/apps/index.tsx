import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useApps, useCreateApp } from "@/api/hooks/use-apps";
import type { App } from "@/api/types";
import { DataTable, type Column } from "@/components/shared/data-table";
import { QualityBadge } from "@/components/shared/quality-badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { VerificationBadge } from "@/components/shared/verification-badge";
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

export const Route = createFileRoute("/apps/")({
  component: AppsPage,
});

function AppsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [offset, setOffset] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading } = useApps({
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    limit: 50,
    offset,
  });

  const columns: Column<App>[] = [
    {
      key: "canonicalName",
      header: "Name",
      cell: (row) => <span className="font-medium">{row.canonicalName}</span>,
    },
    {
      key: "slug",
      header: "Slug",
      cell: (row) => <span className="font-mono text-sm text-muted-foreground">{row.slug}</span>,
    },
    {
      key: "vendorName",
      header: "Vendor",
      cell: (row) => row.vendorName ?? "--",
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "qualityState",
      header: "Quality",
      cell: (row) => <QualityBadge state={row.qualityState} />,
    },
    {
      key: "verificationTier",
      header: "Verification",
      cell: (row) => <VerificationBadge tier={row.verificationTier} />,
    },
    {
      key: "updatedAt",
      header: "Updated",
      cell: (row) => <TimeAgo date={row.updatedAt} />,
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Apps</h2>
          <p className="mt-1 text-muted-foreground">Manage the application catalog.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create App
        </Button>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search apps..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v);
            setOffset(0);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="deprecated">Deprecated</SelectItem>
            <SelectItem value="merged">Merged</SelectItem>
            <SelectItem value="unlisted">Unlisted</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No apps found."
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
          onRowClick={(row) => navigate({ to: "/apps/$appId", params: { appId: row.id } })}
        />
      </div>

      <CreateAppDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function CreateAppDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [vendor, setVendor] = useState("");
  const [homepage, setHomepage] = useState("");
  const [notes, setNotes] = useState("");
  const createApp = useCreateApp();

  const handleSubmit = () => {
    createApp.mutate(
      {
        slug,
        canonicalName: name,
        vendorName: vendor || undefined,
        homepageUrl: homepage || undefined,
        notes: notes || undefined,
      },
      {
        onSuccess: () => {
          toast.success("App created");
          onOpenChange(false);
          setSlug("");
          setName("");
          setVendor("");
          setHomepage("");
          setNotes("");
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create App</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Slug</Label>
            <Input placeholder="my-app" value={slug} onChange={(e) => setSlug(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">
              Lowercase, hyphens only. Must be unique.
            </p>
          </div>
          <div>
            <Label>Name</Label>
            <Input placeholder="My App" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Vendor</Label>
            <Input
              placeholder="Vendor Name"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
            />
          </div>
          <div>
            <Label>Homepage URL</Label>
            <Input
              placeholder="https://example.com"
              value={homepage}
              onChange={(e) => setHomepage(e.target.value)}
            />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea
              placeholder="Optional notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!slug || !name || createApp.isPending}>
            {createApp.isPending ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
