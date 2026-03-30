import { useForm } from "@tanstack/react-form";
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
import { FormField } from "@/components/shared/form-field";
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
  status: z.enum(["all", "draft", "public", "deprecated", "merged", "unlisted"]).catch("all"),
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
          <Plus />
          Create App
        </Button>
      </div>

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No apps."
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
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="public">Public</SelectItem>
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <CreateAppForm onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function CreateAppForm({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const createApp = useCreateApp();

  const form = useForm({
    defaultValues: {
      slug: "",
      canonicalName: "",
      vendorName: "",
      homepageUrl: "",
      notes: "",
    },
    onSubmit: async ({ value }) => {
      createApp.mutate(
        {
          slug: value.slug,
          canonicalName: value.canonicalName,
          vendorName: value.vendorName || undefined,
          homepageUrl: value.homepageUrl || undefined,
          notes: value.notes || undefined,
        },
        {
          onSuccess: () => {
            toast.success("App created");
            onOpenChange(false);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    },
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create App</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="space-y-4"
      >
        <form.Field
          name="slug"
          validators={{
            onBlur: ({ value }) => {
              if (!value) return "Slug is required";
              if (!/^[a-z0-9-]+$/.test(value))
                return "Slug must be lowercase alphanumeric with hyphens";
              return undefined;
            },
          }}
        >
          {(field) => (
            <FormField
              label="Slug"
              name={field.name}
              meta={field.state.meta}
              description="Lowercase, hyphens only. Must be unique."
            >
              <Input
                id={field.name}
                placeholder="my-app"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}
              />
            </FormField>
          )}
        </form.Field>
        <form.Field
          name="canonicalName"
          validators={{
            onBlur: ({ value }) => (!value ? "Name is required" : undefined),
          }}
        >
          {(field) => (
            <FormField label="Name" name={field.name} meta={field.state.meta}>
              <Input
                id={field.name}
                placeholder="My App"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}
              />
            </FormField>
          )}
        </form.Field>
        <form.Field name="vendorName">
          {(field) => (
            <FormField label="Vendor" name={field.name} meta={field.state.meta}>
              <Input
                id={field.name}
                placeholder="Vendor Name"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </FormField>
          )}
        </form.Field>
        <form.Field name="homepageUrl">
          {(field) => (
            <FormField label="Homepage URL" name={field.name} meta={field.state.meta}>
              <Input
                id={field.name}
                placeholder="https://example.com"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}
              />
            </FormField>
          )}
        </form.Field>
        <form.Field name="notes">
          {(field) => (
            <FormField label="Notes" name={field.name} meta={field.state.meta}>
              <Textarea
                id={field.name}
                placeholder="Optional notes..."
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </FormField>
          )}
        </form.Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" disabled={!canSubmit || isSubmitting || createApp.isPending}>
                {createApp.isPending ? "Creating..." : "Create"}
              </Button>
            )}
          </form.Subscribe>
        </DialogFooter>
      </form>
    </>
  );
}
