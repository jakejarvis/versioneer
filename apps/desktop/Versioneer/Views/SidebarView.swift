import SwiftUI

struct SidebarView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var appState = appState

        List(selection: $appState.selectedSection) {
            Section("Apps") {
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
        }
        .listStyle(.sidebar)
        .navigationSplitViewColumnWidth(min: 180, ideal: 200, max: 260)
        .safeAreaInset(edge: .bottom) {
            scanButton
                .padding()
        }
    }

    @ViewBuilder
    private var scanButton: some View {
        switch appState.loadState {
        case .scanning, .submitting:
            ProgressView()
                .controlSize(.small)
                .frame(maxWidth: .infinity)
        default:
            Button {
                Task {
                    await appState.scanAndSubmit()
                }
            } label: {
                Label("Scan & Check", systemImage: "arrow.clockwise")
                    .frame(maxWidth: .infinity)
            }
            .controlSize(.large)
            .buttonStyle(.borderedProminent)
        }
    }
}
