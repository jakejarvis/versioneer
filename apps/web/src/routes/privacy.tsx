import { createFileRoute } from "@tanstack/react-router";

import { getPageSeoHead } from "@/lib/seo";

export const Route = createFileRoute("/privacy")({
  head: () =>
    getPageSeoHead({
      title: "Privacy Policy",
      path: "/privacy",
    }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main className="space-y-5">
      <div className="space-y-1.5">
        <h2 className="text-lg font-medium">Privacy Policy</h2>
        <p className="text-xs text-muted-foreground">Last updated April 22, 2026</p>
      </div>

      <article className="prose">
        <p>
          Versioneer is built to check for macOS app updates without requiring a Versioneer account
          or uploading personal files. This policy explains what the website, desktop app, and
          related services may collect and how that information is used.
        </p>

        <h3>Website analytics</h3>
        <p>
          The website may use privacy-conscious analytics to understand traffic and fix problems.
          This can include page views, download clicks, and browser errors. The site does not use
          analytics to automatically record every button press or form interaction.
        </p>

        <h3>Desktop scans and inventory checks</h3>
        <p>
          The desktop app scans installed macOS apps locally. By default it scans common app
          locations, including /Applications, /Users/Shared/Applications, and your home Applications
          folder, and you can add extra scan directories in settings. It also includes running apps
          that may live outside those folders.
        </p>
        <p>
          For each app it can read, Versioneer may send app metadata needed to match releases and
          verify update routes: app name, bundle identifier, installed version and build number,
          developer team ID, executable architecture, Sparkle feed URL and public key, Mac App Store
          ID, Electron updater provider and URL, signing authority, app category, minimum macOS
          version, Homebrew cask identifier, and a small app icon image. It also sends client
          metadata such as Versioneer version, macOS version, system architecture, channel
          preferences, and scan duration.
        </p>
        <p>
          Inventory requests do not include your local app bundle paths, documents, or full app
          bundles. Recent scan results, including local paths, may be cached on your Mac in
          Versioneer's Application Support data so the app can show results quickly on launch.
        </p>

        <h3>Catalog improvement</h3>
        <p>
          When Versioneer cannot match an installed app to a public catalog entry, the service may
          store a discovery record with the app metadata above, a sighting count, sample versions,
          and optional icon data. This is used to improve app coverage, validate update sources, and
          suggest catalog additions.
        </p>

        <h3>Install and feedback data</h3>
        <p>
          When preparing or reporting an install, Versioneer may send information about the app and
          release being installed, the selected install method, update channel, previous and
          installed versions, bundle identifier, developer team ID, install status, error message,
          and verification summary. Verification summaries can include whether hash, signature,
          notarization, bundle ID, team ID, and version checks passed.
        </p>
        <p>
          If you submit feedback from the app, Versioneer may store the feedback type, app name,
          bundle identifier, matched catalog app, and the feedback details you provide.
        </p>

        <h3>Diagnostics and crash reports</h3>
        <p>
          The desktop app has optional analytics and crash reporting. App settings provide separate
          toggles for analytics collection and crash report collection. When enabled, app telemetry
          includes common properties such as desktop channel, macOS platform, bundle identifier,
          Versioneer version, and build number, plus event-specific metadata such as scan counts,
          update counts, result states, install method, trust status, and whether an action required
          admin privileges.
        </p>
        <p>
          Server logs and diagnostics may include operational details such as request type, request
          path, request identifier, counts, statuses, and sanitized error details. Sensitive values
          such as authorization headers, cookies, passwords, secrets, API keys, and authentication
          credentials are redacted from analytics metadata where detected.
        </p>

        <h3>How we use information</h3>
        <p>
          We use collected information to provide update checks, improve release matching, verify
          installers, maintain the public catalog, diagnose errors, prevent abuse, maintain the
          service, and understand which parts of Versioneer are working well or need attention.
        </p>

        <h3>Sharing</h3>
        <p>
          We do not sell personal information. Information may be shared with service providers that
          host, operate, secure, or analyze Versioneer, or when required to comply with law, protect
          users, or defend the service.
        </p>

        <h3>Your choices</h3>
        <p>
          You can disable optional analytics and crash reporting separately in the Versioneer
          desktop app at any time via the Settings window.
        </p>

        <h3>Retention and security</h3>
        <p>
          We keep information only as long as it is useful for the purposes above or required for
          operational, security, or legal reasons. No system is perfectly secure, but Versioneer is
          designed to minimize collection and protect the information it needs to operate.
        </p>

        <h3>Changes</h3>
        <p>
          This policy may be updated as Versioneer changes. The latest version will be posted on
          this page with a new update date.
        </p>
      </article>
    </main>
  );
}
