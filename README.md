<p align="center">
  <a href="https://versioneer.app"><img width="72" height="72" alt="Versioneer" src="https://assets-prod.versioneer.app/icons/b4b037ffcfcd.png" /></a><br />
  <a href="https://versioneer.app"><strong>Versioneer</strong></a> — macOS App Updater
</p>

## Why?

I wanted a modern replacement for [MacUpdater](https://www.corecode.io/macupdater/) (RIP) that goes much farther than the current alternatives, most of which are closed-source and (from what I can tell) essentially Homebrew wrappers for cask management. [**Versioneer**](https://versioneer.app/) is focused on widespread app compatibility, privacy-friendly data crowdsourcing, and safe one-click installs, all behind a beautiful, fast, and native UI.

## Features

- **Flexible sourcing** — cross-references Sparkle, Electron, GitHub releases, Mac App Store, Homebrew casks, and custom parsers (JSON, XML, HTML, regex) for any weird edge cases.
- **Crowdsourced catalog** — new apps are discovered automatically from anonymized user inventories (opt-in) and further enriched from public metadata.
- **Trusts but verifies** — checksum, codesign, Gatekeeper, bundle ID, and team ID checks before any install.
- **Risk-averse** — every match and version has a numeric confidence level, computed and displayed in-app for full transparency.
- **Safety first** — delegates to Sparkle, Homebrew, the App Store, or a simple find-and-replace depending on how the app was installed & how updates are distributed; a privileged helper is engaged **only** when triggered by macOS.
- **Works independently** — local checkers run in parallel with the cloud API.
- **Privacy first** — anonymized inventory, no accounts, no personal data.
- **Open-source and free** — because duh.

## Installation

Coming soon™...

## License

[MIT](LICENSE)
