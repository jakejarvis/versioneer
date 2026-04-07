import { useForm } from "@tanstack/react-form";
import { resolveSourceUrl } from "@versioneer/core/sources";
import type { SourceType } from "@versioneer/schemas/sources";
import {
  defaultParserKeyForSourceType,
  defaultPollIntervalForSourceType,
} from "@versioneer/schemas/sources";
import { toast } from "sonner";

import { FormField } from "@/components/shared/form-field";
import { serializeConfig, SourceConfigFields } from "@/components/shared/source-config-fields";
import { Badge } from "@/components/ui/badge";
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
import { useCreateSource, useValidateSource } from "@/hooks/use-sources";
import { SOURCE_TYPES } from "@/lib/source-types";

interface CreateSourceDialogProps {
  appId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateSourceDialog({ appId, open, onOpenChange }: CreateSourceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <CreateSourceForm appId={appId} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function CreateSourceForm({
  appId,
  onOpenChange,
}: {
  appId?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const createSource = useCreateSource();
  const validate = useValidateSource();

  const form = useForm({
    defaultValues: {
      appId: appId ?? "",
      sourceType: "sparkle" as SourceType,
      label: "",
      identifier: "",
      parserKey: "sparkle",
      channel: "",
      pollIntervalMinutes: 60,
      config: {} as Record<string, string>,
    },
    onSubmit: async ({ value }) => {
      const baseUrl = resolveSourceUrl(value.sourceType, value.identifier) ?? undefined;
      const configJson = serializeConfig(value.config);

      // Validate the source before creating (skip for manual sources or empty URLs)
      if (value.sourceType !== "manual" && baseUrl) {
        try {
          const result = await validate.mutateAsync({
            url: baseUrl,
            sourceType: value.sourceType,
            configJson,
          });
          if (result.status !== "valid") {
            toast.error(result.errors[0] ?? "Validation failed");
            return;
          }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Validation failed");
          return;
        }
      }

      createSource.mutate(
        {
          appId: value.appId,
          sourceType: value.sourceType,
          label: value.label || undefined,
          baseUrl,
          parserKey: value.parserKey,
          channel: value.channel || undefined,
          configJson,
          pollIntervalMinutes: value.pollIntervalMinutes,
        },
        {
          onSuccess: () => {
            toast.success("Source created");
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
                  validate.reset();
                  form.setFieldValue("parserKey", defaultParserKeyForSourceType(sourceType));
                  form.setFieldValue(
                    "pollIntervalMinutes",
                    defaultPollIntervalForSourceType(sourceType),
                  );
                  form.setFieldValue("identifier", "");
                  form.setFieldValue("config", {});
                }}
              >
                <SelectTrigger id={field.name}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SOURCE_TYPES).map(([value, cfg]) => (
                    <SelectItem key={value} value={value}>
                      {cfg.label}
                    </SelectItem>
                  ))}
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
              <form.Field name="identifier">
                {(field) => (
                  <FormField
                    label={SOURCE_TYPES[sourceType].input.label || "URL"}
                    name={field.name}
                    meta={field.state.meta}
                  >
                    <div className="flex gap-2">
                      <Input
                        id={field.name}
                        placeholder={SOURCE_TYPES[sourceType].input.placeholder}
                        value={field.state.value}
                        onChange={(e) => {
                          field.handleChange(e.target.value);
                          validate.reset();
                        }}
                        onBlur={field.handleBlur}
                        aria-invalid={
                          field.state.meta.isTouched && field.state.meta.errors.length > 0
                        }
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!field.state.value || validate.isPending}
                        onClick={() => {
                          const url = resolveSourceUrl(sourceType, field.state.value);
                          if (!url) return;
                          validate.mutate({
                            url,
                            sourceType,
                            configJson: serializeConfig(form.getFieldValue("config")),
                          });
                        }}
                      >
                        {validate.isPending ? "Testing..." : "Test"}
                      </Button>
                    </div>
                    {validate.data && (
                      <Badge
                        variant="outline"
                        className={`mt-1.5 text-xs ${
                          validate.data.status === "valid"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
                        }`}
                      >
                        {validate.data.status === "valid"
                          ? `${validate.data.releaseCount} releases found (latest: ${validate.data.latestVersion})`
                          : validate.data.errors[0]}
                      </Badge>
                    )}
                  </FormField>
                )}
              </form.Field>
            ) : null
          }
        </form.Subscribe>

        <form.Subscribe selector={(state) => state.values.sourceType}>
          {(sourceType) => (
            <form.Field name="config">
              {(field) => (
                <SourceConfigFields
                  sourceType={sourceType}
                  value={field.state.value}
                  onChange={(v) => field.handleChange(v)}
                />
              )}
            </form.Field>
          )}
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
                disabled={
                  !canSubmit || isSubmitting || createSource.isPending || validate.isPending
                }
              >
                {validate.isPending
                  ? "Validating..."
                  : createSource.isPending
                    ? "Creating..."
                    : "Create"}
              </Button>
            )}
          </form.Subscribe>
        </DialogFooter>
      </form>
    </>
  );
}
