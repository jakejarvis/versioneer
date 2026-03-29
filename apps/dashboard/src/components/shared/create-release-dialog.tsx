import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";

import { useCreateRelease } from "@/api/hooks/use-releases";
import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
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

interface CreateReleaseDialogProps {
  appId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateReleaseDialog({ appId, open, onOpenChange }: CreateReleaseDialogProps) {
  const createRelease = useCreateRelease();

  const form = useForm({
    defaultValues: {
      appId: appId ?? "",
      versionRaw: "",
      buildNumber: "",
      channel: "stable",
      releasedAt: "",
      releaseNotesHtml: "",
      releaseNotesUrl: "",
    },
    onSubmit: async ({ value }) => {
      createRelease.mutate(
        {
          appId: value.appId,
          versionRaw: value.versionRaw,
          buildNumber: value.buildNumber || undefined,
          channel: value.channel,
          releasedAt: value.releasedAt || undefined,
          releaseNotesHtml: value.releaseNotesHtml || undefined,
          releaseNotesUrl: value.releaseNotesUrl || undefined,
        },
        {
          onSuccess: () => {
            toast.success("Release created");
            onOpenChange(false);
            form.reset();
          },
          onError: (err) => toast.error(err.message),
        },
      );
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Release</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className="space-y-4"
        >
          <form.Field
            name="appId"
            validators={{
              onBlur: ({ value }) => (!value ? "App ID is required" : undefined),
            }}
          >
            {(field) => (
              <FormField label="App ID" name={field.name} meta={field.state.meta}>
                <Input
                  id={field.name}
                  placeholder="app_xxx"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  readOnly={!!appId}
                  aria-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}
                />
              </FormField>
            )}
          </form.Field>

          <div className="grid grid-cols-2 gap-4">
            <form.Field
              name="versionRaw"
              validators={{
                onBlur: ({ value }) => (!value ? "Version is required" : undefined),
              }}
            >
              {(field) => (
                <FormField label="Version" name={field.name} meta={field.state.meta}>
                  <Input
                    id={field.name}
                    placeholder="1.2.3"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    aria-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}
                  />
                </FormField>
              )}
            </form.Field>
            <form.Field name="buildNumber">
              {(field) => (
                <FormField label="Build Number" name={field.name} meta={field.state.meta}>
                  <Input
                    id={field.name}
                    placeholder="Optional"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                </FormField>
              )}
            </form.Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <form.Field name="channel">
              {(field) => (
                <FormField label="Channel" name={field.name} meta={field.state.meta}>
                  <Select value={field.state.value} onValueChange={(v) => field.handleChange(v)}>
                    <SelectTrigger id={field.name}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stable">Stable</SelectItem>
                      <SelectItem value="beta">Beta</SelectItem>
                      <SelectItem value="nightly">Nightly</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            </form.Field>
            <form.Field name="releasedAt">
              {(field) => (
                <FormField
                  label="Released At"
                  name={field.name}
                  meta={field.state.meta}
                  description="ISO 8601 timestamp. Defaults to now."
                >
                  <Input
                    id={field.name}
                    type="datetime-local"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                </FormField>
              )}
            </form.Field>
          </div>

          <form.Field name="releaseNotesUrl">
            {(field) => (
              <FormField
                label="Release Notes URL"
                name={field.name}
                meta={field.state.meta}
                description="Link to external changelog or release notes page."
              >
                <Input
                  id={field.name}
                  placeholder="https://example.com/changelog"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </FormField>
            )}
          </form.Field>

          <form.Field name="releaseNotesHtml">
            {(field) => (
              <FormField
                label="Release Notes"
                name={field.name}
                meta={field.state.meta}
                description="HTML content. Will be displayed as-is on the release detail page."
              >
                <Textarea
                  id={field.name}
                  placeholder="<p>What's new in this release...</p>"
                  rows={5}
                  className="font-mono text-xs"
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
                <Button
                  type="submit"
                  disabled={!canSubmit || isSubmitting || createRelease.isPending}
                >
                  {createRelease.isPending ? "Creating..." : "Create"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
