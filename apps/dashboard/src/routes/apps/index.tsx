import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { useApps, useCreateApp } from "@/api/hooks/use-apps";
import type { AppListItem } from "@/api/types";
import { DataTable } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
import { AppEntityLink } from "@/components/shared/entity-link";
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
import {
  applyPaginationToSearch,
  applySortingToSearch,
  paginatedSearchShape,
  paginationFromSearch,
  sortingFromSearch,
} from "@/lib/data-table-search";

const appsSearchSchema = z.object({
  ...paginatedSearchShape,
  search: z.string().catch(""),
  status: z.enum(["all", "active", "deprecated", "merged", "unlisted"]).catch("all"),
});

export const Route = createFileRoute("/apps/")({
  validateSearch: (search) => appsSearchSchema.parse(search),
  component: AppsPage,
});

function AppsPage() {
  const navigate = useNavigate();
  const searchState = Route.useSearch();
  const [createOpen, setCreateOpen] = useState(false);
  const pagination = paginationFromSearch(searchState);
  const sorting = sortingFromSearch(searchState);

  const { data, isLoading } = useApps({
    search: searchState.search || undefined,
    status: searchState.status !== "all" ? searchState.status : undefined,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    sortBy: searchState.sortBy,
    sortDir: searchState.sortDir,
  });

  const columns = useMemo<ColumnDef<AppListItem>[]>(
    () => [
      {
        accessorKey: "canonicalName",
        meta: { label: "App" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="App" />,
        cell: ({ row }) => (
          <AppEntityLink
            app={{
              id: row.original.id,
              canonicalName: row.original.canonicalName,
              slug: row.original.slug,
              vendorName: row.original.vendorName,
              iconR2Key: row.original.iconR2Key,
              status: row.original.status,
            }}
            showId
          />
        ),
      },
      {
        accessorKey: "sourceCount",
        meta: { label: "Sources" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Sources" />,
        cell: ({ row }) => (
          <span className="font-semibold tabular-nums">{row.original.sourceCount}</span>
        ),
      },
      {
        accessorKey: "status",
        meta: { label: "Status" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "qualityScore",
        meta: { label: "Quality" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Quality" />,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-1">
            <QualityBadge state={row.original.qualityState} />
            <span className="text-xs text-muted-foreground">
              {row.original.qualityScore != null
                ? `Score ${row.original.qualityScore}`
                : "No score"}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "verificationTier",
        meta: { label: "Verification" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Verification" />,
        cell: ({ row }) => <VerificationBadge tier={row.original.verificationTier} />,
      },
      {
        accessorKey: "updatedAt",
        meta: { label: "Updated" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Updated" />,
        cell: ({ row }) => <TimeAgo date={row.original.updatedAt} />,
      },
      {
        id: "actions",
        meta: { label: "Actions" },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Button asChild variant="ghost" size="sm">
            <Link to="/apps/$appId" params={{ appId: row.original.id }}>
              Open
            </Link>
          </Button>
        ),
      },
    ],
    [],
  );

  const handleSortingChange = (updater: SortingState | ((prev: SortingState) => SortingState)) => {
    void navigate({
      to: "/apps",
      search: applySortingToSearch(searchState, updater),
    });
  };

  const pageCount = data ? Math.max(1, Math.ceil(data.total / pagination.pageSize)) : 0;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Apps</h2>
          <p className="mt-1 text-muted-foreground">Manage the application catalog.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create App
        </Button>
      </div>

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No apps found."
          sorting={sorting}
          onSortingChange={handleSortingChange}
          manualSorting
          enableColumnVisibility
          toolbar={
            <>
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search apps..."
                  value={searchState.search}
                  onChange={(event) =>
                    void navigate({
                      to: "/apps",
                      search: {
                        ...searchState,
                        page: 1,
                        search: event.target.value,
                      },
                    })
                  }
                  className="pl-9"
                />
              </div>
              <Select
                value={searchState.status}
                onValueChange={(value) =>
                  void navigate({
                    to: "/apps",
                    search: {
                      ...searchState,
                      page: 1,
                      status: value as typeof searchState.status,
                    },
                  })
                }
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
            </>
          }
          pagination={
            data
              ? {
                  total: data.total,
                  pageIndex: pagination.pageIndex,
                  pageSize: pagination.pageSize,
                  pageCount,
                  onPaginationChange: (updater) =>
                    void navigate({
                      to: "/apps",
                      search: applyPaginationToSearch(searchState, updater),
                    }),
                }
              : undefined
          }
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
