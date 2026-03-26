import SwiftUI

struct SidebarView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var appState = appState

        VStack(alignment: .leading, spacing: 12) {
            VersioneerSectionHeader(
                eyebrow: "Versioneer",
                title: "Installed Apps",
                subtitle: appState.hasCachedResults ? summarySubtitle : "Run a scan to build your local inventory."
            )
            .padding(.horizontal, 16)
            .padding(.top, 16)

            List(selection: $appState.selectedSection) {
                ForEach(AppState.SidebarSection.allCases) { section in
                    Label {
                        Text(section.rawValue)
                    } icon: {
                        Image(systemName: section.systemImage)
                    }
                    .badge(appState.badgeCount(for: section) ?? 0)
                    .tag(section)
                }
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
        }
        .navigationSplitViewColumnWidth(min: 180, ideal: 200, max: 260)
    }

    private var summarySubtitle: String {
        let summary = appState.scanSummary
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        let timeText = summary.lastCompletedAt.map { formatter.localizedString(for: $0, relativeTo: Date()) } ?? "not scanned yet"
        return "\(summary.totalApps) apps • \(summary.updatesAvailableCount) updates • \(timeText)"
    }
}
