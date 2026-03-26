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

    private var isScanning: Bool {
        appState.loadState == .scanning || appState.loadState == .submitting
    }

    private var scanButtonLabel: String {
        switch appState.loadState {
        case .scanning: "Scanning…"
        case .submitting: "Checking…"
        default: "Scan & Check"
        }
    }

    private var scanButton: some View {
        Button {
            Task {
                await appState.scanAndSubmit()
            }
        } label: {
            HStack(spacing: 6) {
                if isScanning {
                    ProgressView()
                        .controlSize(.small)
                }
                Text(scanButtonLabel)
            }
            .frame(maxWidth: .infinity)
        }
        .controlSize(.large)
        .buttonStyle(.borderedProminent)
        .disabled(isScanning)
    }
}
