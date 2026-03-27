import SwiftUI

struct FilterTabsView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var appState = appState

        HStack(spacing: 8) {
            ForEach(AppState.SidebarSection.allCases) { section in
                FilterTab(
                    title: section.rawValue,
                    count: tabCount(for: section),
                    isSelected: appState.selectedSection == section
                ) {
                    withAnimation(.snappy(duration: 0.2)) {
                        appState.selectedSection = section
                    }
                }
            }

            Spacer()
        }
    }

    private func tabCount(for section: AppState.SidebarSection) -> Int {
        switch section {
        case .all:
            appState.scanSummary.totalApps
        case .updatesAvailable:
            appState.scanSummary.updatesAvailableCount
        case .unknown:
            appState.scanSummary.unknownCount
        case .unsupported:
            appState.scanSummary.unsupportedCount
        }
    }
}

private struct FilterTab: View {
    let title: String
    let count: Int
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(title)
                    .font(.subheadline.weight(isSelected ? .semibold : .regular))

                if count > 0 {
                    Text("\(count)")
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background {
                            Capsule(style: .continuous)
                                .fill(isSelected ? Color.accentColor.opacity(0.2) : Color.white.opacity(0.08))
                        }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .foregroundStyle(isSelected ? .primary : .secondary)
        .background {
            if isSelected {
                Capsule(style: .continuous)
                    .fill(.white.opacity(0.1))
                    .glassEffect(.regular, in: .capsule)
            }
        }
    }
}
