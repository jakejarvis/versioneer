import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";

import { useUpdateApp } from "@/api/hooks/use-apps";
import type { App } from "@/api/types";
import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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

interface EditAppDialogProps {
  app: App;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditAppDialog({ app, open, onOpenChange }: EditAppDialogProps) {
  const updateApp = useUpdateApp(app.id);

  const form = useForm({
    defaultValues: {
      canonicalName: app.canonicalName,
      vendorName: app.vendorName ?? "",
      homepageUrl: app.homepageUrl ?? "",
      status: app.status,
      mergedIntoAppId: app.mergedIntoAppId ?? "",
      notes: app.notes ?? "",
      isVerified: app.isVerified,
      installStrategyOverride: app.installStrategyOverride ?? "",
    },
    onSubmit: async ({ value }) => {
      updateApp.mutate(
        {
          canonicalName: value.canonicalName,
          vendorName: value.vendorName || null,
          homepageUrl: value.homepageUrl || null,
          status: value.status,
          mergedIntoAppId: value.status === "merged" ? value.mergedIntoAppId || null : null,
          notes: value.notes || null,
          isVerified: value.isVerified,
          installStrategyOverride: value.installStrategyOverride || null,
        },
        {
          onSuccess: () => {
            toast.success("App updated");
            onOpenChange(false);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit App</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className="space-y-4"
        >
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

          <form.Field name="status">
            {(field) => (
              <FormField label="Status" name={field.name} meta={field.state.meta}>
                <Select
                  value={field.state.value}
                  onValueChange={(v) => field.handleChange(v as typeof field.state.value)}
                >
                  <SelectTrigger id={field.name}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="deprecated">Deprecated</SelectItem>
                    <SelectItem value="merged">Merged</SelectItem>
                    <SelectItem value="unlisted">Unlisted</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            )}
          </form.Field>

          <form.Subscribe selector={(state) => state.values.status}>
            {(status) =>
              status === "merged" ? (
                <form.Field name="mergedIntoAppId">
                  {(field) => (
                    <FormField
                      label="Merged Into App ID"
                      name={field.name}
                      meta={field.state.meta}
                      description="The app_xxx ID this app was merged into."
                    >
                      <Input
                        id={field.name}
                        placeholder="app_xxx"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                      />
                    </FormField>
                  )}
                </form.Field>
              ) : null
            }
          </form.Subscribe>

          <form.Field name="installStrategyOverride">
            {(field) => (
              <FormField
                label="Install Strategy Override"
                name={field.name}
                meta={field.state.meta}
                description="Leave empty to use auto-detected strategy."
              >
                <Select
                  value={field.state.value || "auto"}
                  onValueChange={(v) => field.handleChange(v === "auto" ? "" : v)}
                >
                  <SelectTrigger id={field.name}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-detect</SelectItem>
                    <SelectItem value="sparkle">Sparkle</SelectItem>
                    <SelectItem value="zip_replace">ZIP Replace</SelectItem>
                    <SelectItem value="dmg_copy_replace">DMG Copy Replace</SelectItem>
                    <SelectItem value="pkg_install">PKG Install</SelectItem>
                    <SelectItem value="manual_only">Manual Only</SelectItem>
                  </SelectContent>
                </Select>
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

          <form.Field name="isVerified">
            {(field) => (
              <div className="flex items-center gap-2">
                <Checkbox
                  id={field.name}
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked === true)}
                />
                <label htmlFor={field.name} className="text-sm font-medium">
                  Verified
                </label>
              </div>
            )}
          </form.Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting || updateApp.isPending}>
                  {updateApp.isPending ? "Saving..." : "Save"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
