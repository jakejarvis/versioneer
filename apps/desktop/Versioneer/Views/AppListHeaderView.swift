import SwiftUI

struct AppListHeaderView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        VStack(spacing: 12) {
            summaryRow
            FilterTabsView()
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 8)
    }

    private var summaryRow: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    Text(summaryText)
                        .font(.title3.weight(.semibold))

                    if let lastScan = appState.scanSummary.lastCompletedAt {
                        Text("·")
                            .foregroundStyle(.quaternary)
                        Text(lastScan, style: .relative)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Spacer()

            sortPicker

            scanButton
        }
    }

    private var summaryText: String {
        let summary = appState.scanSummary
        if summary.totalApps == 0 && appState.loadState == .idle {
            return "Versioneer"
        }
        let parts = ["\(summary.totalApps) apps"]
        if summary.updatesAvailableCount > 0 {
            return parts.joined() + " · \(summary.updatesAvailableCount) updates"
        }
        return parts.joined()
    }

    private var sortPicker: some View {
        @Bindable var appState = appState
        return Picker("Sort", selection: $appState.resultsSort) {
            ForEach(ResultsBrowserSort.allCases) { sort in
                Text(sort.title).tag(sort)
            }
        }
        .pickerStyle(.menu)
        .fixedSize()
    }

    private var scanButton: some View {
        Button {
            Task { await appState.scanAndSubmit() }
        } label: {
            HStack(spacing: 8) {
                if appState.loadState == .scanning || appState.loadState == .submitting {
                    ProgressView()
                        .controlSize(.small)
                }
                Text(scanButtonLabel)
            }
        }
        .buttonStyle(.borderedProminent)
        .disabled(appState.loadState == .scanning || appState.loadState == .submitting)
    }

    private var scanButtonLabel: String {
        switch appState.loadState {
        case .scanning:
            "Scanning…"
        case .submitting:
            "Checking…"
        default:
            "Scan & Check"
        }
    }
}
