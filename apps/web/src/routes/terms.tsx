import { createFileRoute } from "@tanstack/react-router";

import { getPageSeoHead } from "@/lib/seo";

export const Route = createFileRoute("/terms")({
  head: () =>
    getPageSeoHead({
      title: "Terms of Use",
      path: "/terms",
    }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <main className="space-y-5">
      <div className="space-y-1.5">
        <h2 className="text-lg font-medium">Terms of Use</h2>
        <p className="text-xs text-muted-foreground">Last updated April 22, 2026</p>
      </div>

      <article className="prose">
        <p>
          These terms apply to the Versioneer website, app, APIs, and related services. By using
          Versioneer, you agree to use it responsibly and only where you have the right to install,
          update, or inspect the apps involved.
        </p>

        <h3>What Versioneer does</h3>
        <p>
          Versioneer scans installed macOS apps, compares local app metadata with the Versioneer
          catalog and local update sources, and presents update decisions. The app can check sources
          such as Sparkle feeds, Electron updater metadata, Mac App Store records, Homebrew casks,
          GitHub releases, and other cataloged release sources.
        </p>
        <p>
          Some checks run locally in the desktop app. Others use the Versioneer service to match
          apps, select compatible releases, prepare installs, and record install status. You are
          responsible for deciding whether to install any update and for complying with the license
          terms, policies, and requirements of each third-party app or service.
        </p>

        <h3>Your control</h3>
        <p>
          Versioneer settings let you control scan-on-launch behavior, directory watching, extra
          scan directories, analytics collection, crash report collection, and confirmation prompts
          for bulk or admin-required installs. You are responsible for any settings changes, custom
          service URL, custom scan root, or custom tool path you configure.
        </p>

        <h3>Third-party software and services</h3>
        <p>
          Versioneer may link to or inspect release feeds, package managers, app stores, vendor
          websites, GitHub releases, Sparkle feeds, and other third-party sources. Those sources are
          controlled by their respective owners, and Versioneer is not responsible for their
          availability, accuracy, content, licenses, or behavior.
        </p>
        <p>
          When Versioneer routes an update through an external tool or service, such as Sparkle,
          Homebrew, or the Mac App Store, that tool or service remains responsible for its own
          behavior. Versioneer may also fall back to manual update guidance when it cannot establish
          a trusted automatic install method.
        </p>

        <h3>Open-source license</h3>
        <p>
          Versioneer source code is provided under the license published in the project repository.
          These terms do not replace that license for source code covered by it. Hosted services,
          website use, and app-connected services remain subject to these terms.
        </p>

        <h3>Acceptable use</h3>
        <p>
          Do not misuse Versioneer, interfere with the service, attempt to bypass security limits,
          submit misleading metadata, scrape or overload the service, or use Versioneer to
          distribute malware, violate software licenses, or infringe anyone's rights.
        </p>

        <h3>Catalog and compatibility</h3>
        <p>
          Versioneer's catalog, release metadata, compatibility decisions, confidence scores,
          install strategies, and trust checks are best-effort signals. They can be incomplete,
          stale, inaccurate, or unavailable. You should review update details before installing,
          especially when an update requires administrator privileges, uses a package installer, or
          comes from a source outside the Mac App Store or Homebrew.
        </p>

        <h3>Feedback and submissions</h3>
        <p>
          If you submit feedback, app metadata, or other information to Versioneer, you confirm that
          you have the right to provide it and that it is accurate to the best of your knowledge.
          You grant Versioneer permission to use those submissions to operate the service, improve
          the catalog, diagnose issues, and develop related features.
        </p>

        <h3>No warranties</h3>
        <p>
          Versioneer is provided as is and as available. We do not promise that update information,
          release matching, downloads, verification checks, or services will be uninterrupted,
          error-free, complete, or suitable for any particular purpose.
        </p>

        <h3>Limitation of liability</h3>
        <p>
          To the fullest extent allowed by law, Versioneer and its maintainers will not be liable
          for indirect, incidental, special, consequential, exemplary, or lost-profit damages
          arising from your use of Versioneer or third-party software discovered through it.
        </p>

        <h3>Changes</h3>
        <p>
          These terms may be updated as Versioneer changes. The latest version will be posted on
          this page with a new update date.
        </p>
      </article>
    </main>
  );
}
