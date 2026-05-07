import { useRouter } from "@tanstack/react-router";

export function RouteError() {
  const router = useRouter();

  return (
    <main className="py-12 space-y-4 text-center">
      <div className="space-y-1.5">
        <h2 className="text-lg font-medium">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">The page could not be loaded.</p>
      </div>

      <div className="flex items-center justify-center gap-3 text-sm">
        <button
          type="button"
          onClick={() => void router.invalidate()}
          className="cursor-pointer underline underline-offset-4 hover:text-foreground"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
