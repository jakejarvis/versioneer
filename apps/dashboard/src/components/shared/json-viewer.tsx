import { cn } from "@/lib/utils";

interface JsonViewerProps {
  data: string | null | undefined;
  className?: string;
}

export function JsonViewer({ data, className }: JsonViewerProps) {
  if (!data) return <span className="text-muted-foreground">--</span>;

  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(data), null, 2);
  } catch {
    formatted = data;
  }

  return (
    <pre
      className={cn("max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs", className)}
    >
      {formatted}
    </pre>
  );
}
