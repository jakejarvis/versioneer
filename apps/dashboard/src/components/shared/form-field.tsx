import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";

interface FieldMeta {
  isTouched: boolean;
  errors: Array<unknown>;
}

interface FormFieldProps {
  label: string;
  name: string;
  meta: FieldMeta;
  children: ReactNode;
  description?: string;
}

function formatErrors(errors: FieldMeta["errors"]): string[] {
  return errors
    .filter((e): e is string | { message: string } => e != null)
    .map((e) => (typeof e === "string" ? e : e.message));
}

export function FormField({ label, name, meta, children, description }: FormFieldProps) {
  const formattedErrors = meta.isTouched ? formatErrors(meta.errors) : [];
  const hasError = formattedErrors.length > 0;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      {children}
      {description && !hasError ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
      {hasError ? <p className="text-xs text-destructive">{formattedErrors.join(", ")}</p> : null}
    </div>
  );
}
