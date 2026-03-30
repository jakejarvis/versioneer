import type { SourceType } from "@versioneer/schemas/sources";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SOURCE_CONFIG_FIELDS } from "@/lib/source-types";

interface SourceConfigFieldsProps {
  sourceType: SourceType;
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  compact?: boolean;
}

export function SourceConfigFields({
  sourceType,
  value,
  onChange,
  compact,
}: SourceConfigFieldsProps) {
  const schema = SOURCE_CONFIG_FIELDS[sourceType];
  if (!schema) return null;

  const handleFieldChange = (key: string, fieldValue: string) => {
    onChange({ ...value, [key]: fieldValue });
  };

  if (compact) {
    return (
      <div className="space-y-1.5 px-0.5">
        <p className="text-[9px] text-muted-foreground/60">{schema.description}</p>
        {schema.fields.map((field) => (
          <div key={field.key}>
            <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">
              {field.label}
              {field.required && <span className="text-destructive"> *</span>}
            </label>
            <input
              value={value[field.key] ?? ""}
              onChange={(e) => handleFieldChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              className={`w-full rounded border border-border/40 bg-muted/30 px-2 py-1 font-mono text-[10px] text-muted-foreground outline-none placeholder:text-muted-foreground/40 ${field.short ? "max-w-20" : ""}`}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{schema.description}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {schema.fields.map((field) => (
          <div key={field.key} className={field.short ? "sm:col-span-1" : "sm:col-span-2"}>
            <Label htmlFor={`config-${field.key}`} className="mb-1.5 block">
              {field.label}
              {field.required && <span className="text-destructive"> *</span>}
            </Label>
            <Input
              id={`config-${field.key}`}
              value={value[field.key] ?? ""}
              onChange={(e) => handleFieldChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              className="font-mono text-xs"
            />
            {field.description && (
              <p className="mt-1 text-xs text-muted-foreground">{field.description}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Parse a configJson string into a Record, returning {} on failure. */
export function parseConfigJson(configJson: string | null): Record<string, string> {
  if (!configJson) return {};
  try {
    const parsed = JSON.parse(configJson);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") result[k] = v;
    }
    return result;
  } catch {
    return {};
  }
}

/** Serialize a config Record to JSON string, returning undefined if all values are empty. */
export function serializeConfig(config: Record<string, string>): string | undefined {
  const nonEmpty = Object.fromEntries(Object.entries(config).filter(([, v]) => v.trim()));
  if (Object.keys(nonEmpty).length === 0) return undefined;
  return JSON.stringify(nonEmpty);
}
