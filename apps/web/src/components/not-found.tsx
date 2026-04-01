import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <div className="text-center space-y-2 py-12">
      <h2 className="text-xl font-mono font-medium">404</h2>
      <p className="text-sm text-muted-foreground">
        Page not found.{" "}
        <Link to="/" className="underline-offset-4 underline hover:text-foreground">
          Go home?
        </Link>
      </p>
    </div>
  );
}
