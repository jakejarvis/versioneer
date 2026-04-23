import { Link, useRouter } from "@tanstack/react-router";

export function RouteError() {
  const router = useRouter();

  return (
    <main className="py-12 space-y-4 text-center">
      <div className="space-y-1.5">
        <h2 className="text-lg font-medium">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">
          The page could not be loaded. Try again, or head back home.
        </p>
      </div>

      <div className="flex items-center justify-center gap-3 text-sm">
        <button
          type="button"
          onClick={() => void router.invalidate()}
          className="underline underline-offset-4 hover:text-foreground"
        >
          Try again
        </button>
        <span className="text-foreground/50 pointer-events-none">•</span>
        <Link to="/" className="underline underline-offset-4 hover:text-foreground">
          Go home
        </Link>
      </div>
    </main>
  );
}
