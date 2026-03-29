import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";

import { useCreateSource } from "@/api/hooks/use-sources";
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

type SourceType = "sparkle" | "github_releases" | "manual" | "homebrew_cask" | "mac_app_store";

const PARSER_KEY_DEFAULTS: Record<SourceType, string> = {
  sparkle: "sparkle",
  github_releases: "github_releases",
  homebrew_cask: "homebrew_cask",
  mac_app_store: "mac_app_store",
  manual: "manual",
};

interface CreateSourceDialogProps {
  appId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateSourceDialog({ appId, open, onOpenChange }: CreateSourceDialogProps) {
  const createSource = useCreateSource();

  const form = useForm({
    defaultValues: {
      appId: appId ?? "",
      sourceType: "sparkle" as SourceType,
      label: "",
      baseUrl: "",
      parserKey: "sparkle",
      channel: "",
      pollIntervalMinutes: 60,
    },
    onSubmit: async ({ value }) => {
      createSource.mutate(
        {
          appId: value.appId,
          sourceType: value.sourceType,
          label: value.label || undefined,
          baseUrl: value.baseUrl || undefined,
          parserKey: value.parserKey,
          pollIntervalMinutes: value.pollIntervalMinutes,
        },
        {
          onSuccess: () => {
            toast.success("Source created");
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Source</DialogTitle>
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

          <form.Field name="sourceType">
            {(field) => (
              <FormField label="Source Type" name={field.name} meta={field.state.meta}>
                <Select
                  value={field.state.value}
                  onValueChange={(v) => {
                    const sourceType = v as SourceType;
                    field.handleChange(sourceType);
                    form.setFieldValue("parserKey", PARSER_KEY_DEFAULTS[sourceType]);
                  }}
                >
                  <SelectTrigger id={field.name}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sparkle">Sparkle</SelectItem>
                    <SelectItem value="github_releases">GitHub Releases</SelectItem>
                    <SelectItem value="homebrew_cask">Homebrew Cask</SelectItem>
                    <SelectItem value="mac_app_store">Mac App Store</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            )}
          </form.Field>

          <form.Field name="label">
            {(field) => (
              <FormField label="Label" name={field.name} meta={field.state.meta}>
                <Input
                  id={field.name}
                  placeholder="Optional label"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </FormField>
            )}
          </form.Field>

          <form.Subscribe selector={(state) => state.values.sourceType}>
            {(sourceType) =>
              sourceType !== "manual" ? (
                <form.Field name="baseUrl">
                  {(field) => (
                    <FormField label="Base URL" name={field.name} meta={field.state.meta}>
                      <Input
                        id={field.name}
                        placeholder={
                          sourceType === "github_releases"
                            ? "https://api.github.com/repos/owner/repo/releases"
                            : "https://example.com/appcast.xml"
                        }
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        aria-invalid={
                          field.state.meta.isTouched && field.state.meta.errors.length > 0
                        }
                      />
                    </FormField>
                  )}
                </form.Field>
              ) : null
            }
          </form.Subscribe>

          <form.Field
            name="parserKey"
            validators={{
              onBlur: ({ value }) => (!value ? "Parser key is required" : undefined),
            }}
          >
            {(field) => (
              <FormField label="Parser Key" name={field.name} meta={field.state.meta}>
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

          <form.Field name="channel">
            {(field) => (
              <FormField label="Channel" name={field.name} meta={field.state.meta}>
                <Select
                  value={field.state.value || "auto"}
                  onValueChange={(v) => field.handleChange(v === "auto" ? "" : v)}
                >
                  <SelectTrigger id={field.name}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-detect</SelectItem>
                    <SelectItem value="stable">Stable</SelectItem>
                    <SelectItem value="beta">Beta</SelectItem>
                    <SelectItem value="nightly">Nightly</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            )}
          </form.Field>

          <form.Field name="pollIntervalMinutes">
            {(field) => (
              <FormField
                label="Poll Interval (minutes)"
                name={field.name}
                meta={field.state.meta}
                description="Min 5, max 10080 (1 week)."
              >
                <Input
                  id={field.name}
                  type="number"
                  min={5}
                  max={10080}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(Number(e.target.value))}
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
                  disabled={!canSubmit || isSubmitting || createSource.isPending}
                >
                  {createSource.isPending ? "Creating..." : "Create"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
