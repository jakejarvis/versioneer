import SwiftUI

struct ResultsListView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        Group {
            if appState.hasCachedResults {
                browserContent
            } else {
                switch appState.loadState {
                case .idle:
                    ContentUnavailableView {
                        Label("No Results Yet", systemImage: "arrow.clockwise")
                    } description: {
                        Text("Run a scan to discover installed apps and check for updates.")
                    } actions: {
                        Button("Scan & Check") {
                            Task { await appState.scanAndSubmit() }
                        }
                        .buttonStyle(.borderedProminent)
                    }

                case .scanning:
                    ProgressView("Scanning installed apps…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)

                case .submitting:
                    ProgressView("Checking for updates…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)

                case .done:
                    browserContent

                case .error(let message):
                    ErrorStateView(message: message) {
                        Task { await appState.scanAndSubmit() }
                    }
                }
            }
        }
        .searchable(text: binding(for: \.searchText), prompt: "Filter apps")
        .navigationTitle(appState.selectedSection.rawValue)
    }

    @ViewBuilder
    private var browserContent: some View {
        let rows = appState.resultsBrowserRows
        if rows.isEmpty {
            ContentUnavailableView.search(text: appState.searchText)
        } else {
            Table(rows, selection: binding(for: \.selectedResultID)) {
                TableColumn("App") { row in
                    ResultsAppCell(row: row)
                }
                .width(min: 230, ideal: 280)

                TableColumn("Status") { row in
                    ResultsStatusCell(row: row)
                }
                .width(min: 150, ideal: 180)

                TableColumn("Installed") { row in
                    Text(row.installedVersionText)
                        .font(.callout.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                .width(min: 110, ideal: 120)

                TableColumn("Latest") { row in
                    Text(row.latestVersionText)
                        .font(.callout.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                .width(min: 110, ideal: 120)

                TableColumn("Released") { row in
                    Text(row.releasedDateText)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                .width(min: 110, ideal: 140)
            }
            .tableStyle(.inset)
            .safeAreaInset(edge: .bottom) {
                ResultsSummaryFooter(
                    displayedCount: rows.count,
                    summary: appState.scanSummary,
                    sort: appState.resultsSort
                )
            }
        }
    }

    private func binding<Value>(for keyPath: ReferenceWritableKeyPath<AppState, Value>) -> Binding<Value> {
        Binding(
            get: { appState[keyPath: keyPath] },
            set: { appState[keyPath: keyPath] = $0 }
        )
    }
}

private struct ResultsAppCell: View {
    @Environment(AppState.self) private var appState
    let row: ResultsBrowserRowPresentation

    var body: some View {
        let result = appState.inventoryResults.first { $0.id == row.id }

        HStack(spacing: 12) {
            if let result {
                Image(nsImage: appState.appIcon(for: result))
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 28, height: 28)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(row.appName)
                    .font(.body.weight(.medium))
                    .lineLimit(1)

                if let secondaryText = row.secondaryText {
                    Text(secondaryText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

private struct ResultsStatusCell: View {
    let row: ResultsBrowserRowPresentation

    var body: some View {
        VersioneerStatusChip(
            title: row.statusText,
            tint: tint,
            systemImage: systemImage
        )
    }

    private var tint: Color {
        switch row.statusTone {
        case .accent:
            .accentColor
        case .positive:
            .green
        case .secondary:
            .secondary
        case .warning:
            .orange
        case .negative:
            .red
        }
    }

    private var systemImage: String {
        switch row.statusTone {
        case .accent:
            "arrow.trianglehead.2.clockwise"
        case .positive:
            "checkmark.circle.fill"
        case .secondary:
            "questionmark.circle"
        case .warning:
            "sparkles"
        case .negative:
            "exclamationmark.triangle.fill"
        }
    }
}

private struct ResultsSummaryFooter: View {
    let displayedCount: Int
    let summary: AppState.ScanSummary
    let sort: ResultsBrowserSort

    var body: some View {
        HStack {
            Text("\(displayedCount) shown")
            Text("•")
            Text("\(summary.updatesAvailableCount) updates")
            Text("•")
            Text("Sorted by \(sort.title)")

            Spacer()

            if let lastCompletedAt = summary.lastCompletedAt {
                Text("Last scan \(formatter.localizedString(for: lastCompletedAt, relativeTo: Date()))")
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(.bar)
        .overlay(alignment: .top) {
            Divider()
        }
    }

    private var formatter: RelativeDateTimeFormatter {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter
    }
}
