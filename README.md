<p align="center">
<a href="https://versioneer.app"><img width="72" height="72" alt="Versioneer" src="https://github.com/user-attachments/assets/e2172ca6-b499-4f95-a24c-d1bc1a728c94" /></a>
</p>
<p align="center">
<a href="https://versioneer.app"><strong>Versioneer</strong></a> — macOS App Updater
</p>

## Why?

I wanted a modern replacement for [MacUpdater](https://www.corecode.io/macupdater/) (RIP) that goes much farther than the current alternatives, most of which are closed-source and (from what I can tell) essentially Homebrew wrappers for cask management. [**Versioneer**](https://versioneer.app/) is focused on widespread app compatibility, privacy-friendly data crowdsourcing, and safe one-click installs, all behind a beautiful, fast, and native UI.

## Features

- **Flexible update sources** — cross-references Sparkle, GitHub Releases, Mac App Store, Homebrew Cask, Electron, and custom web/regex/JSON/XML parsers for weird edge cases.
- **Crowdsourced catalog** — new apps detected automatically from anonymized user inventories (opt-in) and further enriched from public metadata.
- **Confidence scoring** — every match and version carries an explicit trust level.
- **Channel-aware** — stable, beta, nightly, etc branches tracked independently.
- **Trusts but verifies** — checksum, codesign, Gatekeeper, bundle ID, and team ID checks before any install.
- **Safety first** — delegates to Sparkle, Homebrew, the App Store, or a simple find-and-replace depending on how the app was installed & how updates are distributed; a privileged helper is used **only** when needed.
- **Works independently** — local checkers run in parallel with the cloud API.
- **Privacy first** — anonymized inventory, no accounts, no personal data.
- **Open-source and free** — because duh.

## Installation

Coming soon™...

## License

[MIT](LICENSE)
