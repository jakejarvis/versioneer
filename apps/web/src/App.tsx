export function App() {
  return (
    <div className="mx-auto max-w-xl px-6 py-20 md:py-32 space-y-10">
      <header className="flex items-center gap-2.5 text-white">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          className="size-6 translate-y-[-1px]"
        >
          <path
            fill="currentColor"
            d="m22.243 20.243l-2.829-2.829L18 16l-4.249 4.249l1.415 1.414L18 18.829l2.828 2.828zM7 15h4v2H7z"
          />
          <path
            fill="currentColor"
            d="M22 6H2v2h2v11a2.003 2.003 0 0 0 2 2h5l7-7l2 2V8h2ZM6 8h12v3l-8 8H6Z"
          />
        </svg>
        <h1 className="font-mono font-medium">Versioneer.app</h1>
      </header>

      <main className="space-y-8">
        <p className="leading-relaxed">
          Tracks macOS app updates so you don&rsquo;t have to. Monitors Sparkle appcasts, GitHub
          releases, and other sources &mdash; resolving the latest version for every app across your
          fleet.
        </p>

        <div className="flex gap-4 text-sm">
          <a href="#" className="text-white hover:opacity-80">
            Download
          </a>
          <span className="text-white/20 select-none">/</span>
          <a href="https://github.com/jakejarvis/versioneer" className="text-fg-muted">
            GitHub
          </a>
        </div>
      </main>
    </div>
  );
}
