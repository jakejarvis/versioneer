import { ArrowUpRightIcon, HardDriveDownloadIcon } from "lucide-react";

export function App() {
  return (
    <div className="mx-auto max-w-xl px-6 py-20 md:py-32 space-y-10">
      <header className="flex items-center justify-between gap-2.5 text-white">
        <a href="/" className="flex items-center gap-2.5">
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
        </a>
        <div>
          <a
            href="https://github.com/jakejarvis/versioneer"
            target="_blank"
            rel="noopener noreferrer"
            className="text-fg/80 hover:text-fg"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-6">
              <path
                fill="currentColor"
                d="M12 1C5.923 1 1 5.923 1 12c0 4.867 3.149 8.979 7.521 10.436c.55.096.756-.233.756-.522c0-.262-.013-1.128-.013-2.049c-2.764.509-3.479-.674-3.699-1.292c-.124-.317-.66-1.293-1.127-1.554c-.385-.207-.936-.715-.014-.729c.866-.014 1.485.797 1.691 1.128c.99 1.663 2.571 1.196 3.204.907c.096-.715.385-1.196.701-1.471c-2.448-.275-5.005-1.224-5.005-5.432c0-1.196.426-2.186 1.128-2.956c-.111-.275-.496-1.402.11-2.915c0 0 .921-.288 3.024 1.128a10.2 10.2 0 0 1 2.75-.371c.936 0 1.871.123 2.75.371c2.104-1.43 3.025-1.128 3.025-1.128c.605 1.513.221 2.64.111 2.915c.701.77 1.127 1.747 1.127 2.956c0 4.222-2.571 5.157-5.019 5.432c.399.344.743 1.004.743 2.035c0 1.471-.014 2.654-.014 3.025c0 .289.206.632.756.522C19.851 20.979 23 16.854 23 12c0-6.077-4.922-11-11-11"
              />
            </svg>
          </a>
        </div>
      </header>

      <main className="space-y-8">
        <p className="leading-relaxed">
          Placeholder text placeholder text placeholder asdf asdf asdf text... Placeholder text
          placeholder xvcboixvcbio text placeholder text... Placeholder text asdf placeholder text
          placeholder text... placeholder text placeholder text.
        </p>

        <div className="flex items-center gap-2 text-sm">
          <a
            href="https://dl.versioneer.app/latest/Versioneer.zip"
            className="text-fg hover:text-fg/80 flex items-center gap-2 underline-offset-4 underline"
          >
            <HardDriveDownloadIcon className="size-3 text-fg" />
            Download
          </a>
          <span className="text-fg-muted text-xs">x.x MB</span>
        </div>
      </main>

      <footer className="mt-12 text-sm text-fg-muted border-t border-fg/10 pt-6">
        <p>
          <span className="text-fg-muted">
            Created by{" "}
            <a
              href="https://jarv.is"
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-4 underline hover:text-fg"
            >
              @jakejarvis
              <ArrowUpRightIcon className="size-3.5 inline-block translate-y-[-1px] ml-0.5" />
            </a>
          </span>
        </p>
      </footer>
    </div>
  );
}
