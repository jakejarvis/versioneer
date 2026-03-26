import SwiftUI

struct ResultsListView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var appState = appState

        Group {
            switch appState.loadState {
            case .idle:
                ContentUnavailableView(
                    "No Results Yet",
                    systemImage: "arrow.clockwise",
                    description: Text("Click \"Scan & Check\" to discover installed apps and check for updates.")
                )

            case .scanning:
                ProgressView("Scanning installed apps…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

            case .submitting:
                ProgressView("Checking for updates…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

            case .done:
                resultsList

            case .error(let message):
                ErrorStateView(message: message) {
                    Task { await appState.scanAndSubmit() }
                }
            }
        }
        .searchable(text: $appState.searchText, prompt: "Filter apps")
        .navigationTitle(appState.selectedSection.rawValue)
    }

    @ViewBuilder
    private var resultsList: some View {
        let results = appState.filteredResults
        if results.isEmpty {
            ContentUnavailableView.search(text: appState.searchText)
        } else {
            List(results, selection: Binding(
                get: { appState.selectedResult },
                set: { appState.selectedResult = $0 }
            )) { result in
                ResultRow(result: result)
                    .tag(result)
            }
            .listStyle(.inset(alternatesRowBackgrounds: true))
        }
    }
}

// MARK: - ResultRow

private struct ResultRow: View {
    @Environment(AppState.self) private var appState
    let result: AppDecision

    var body: some View {
        HStack(spacing: 10) {
            ZStack(alignment: .bottomTrailing) {
                Image(nsImage: appState.appIcon(for: result))
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 32, height: 32)

                DecisionBadge(decision: result.decision)
                    .offset(x: 3, y: 3)
            }
            .frame(width: 32, height: 32)

            VStack(alignment: .leading, spacing: 2) {
                Text(result.matchedAppName ?? result.appName)
                    .fontWeight(.medium)
                    .lineLimit(1)

                if let bundleId = result.bundleId {
                    Text(bundleId)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                Text(VersionFormatting.displayVersion(result.installedVersion))
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if let latest = result.latestVersion {
                    Text(latest)
                        .font(.caption)
                        .foregroundStyle(result.decision == .updateAvailable ? .orange : .secondary)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

// MARK: - DecisionBadge

struct DecisionBadge: View {
    let decision: AppDecision.Decision

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 10, height: 10)
    }

    private var color: Color {
        switch decision {
        case .upToDate: .green
        case .updateAvailable: .orange
        case .unknown: .gray
        case .ambiguous: .yellow
        case .unsupported: .red
        case .ignored: .secondary
        }
    }
}
