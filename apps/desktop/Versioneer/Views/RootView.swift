import SwiftUI

/// The main three-column layout: sidebar, results list, detail.
struct RootView: View {
    @Environment(AppState.self) private var appState
    @Environment(InstallCoordinator.self) private var installCoordinator

    var body: some View {
        NavigationSplitView {
            SidebarView()
        } content: {
            ResultsListView()
        } detail: {
            if let selected = appState.selectedResult {
                AppDetailView(result: selected)
            } else {
                EmptyStateView()
            }
        }
        .frame(minWidth: 1040, minHeight: 620)
        .toolbar { toolbarContent }
        .safeAreaInset(edge: .top) {
            if let shellStatus = appState.shellStatusPresentation {
                ShellStatusStrip(presentation: shellStatus)
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
            }
        }
        .task {
            if appState.settings.scanOnLaunch {
                await Task.yield()
                await appState.scanAndSubmit()
            }
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            Picker("Sort", selection: binding(for: \.resultsSort)) {
                ForEach(ResultsBrowserSort.allCases) { sort in
                    Text(sort.title).tag(sort)
                }
            }
            .pickerStyle(.menu)

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

    private func binding<Value>(for keyPath: ReferenceWritableKeyPath<AppState, Value>) -> Binding<Value> {
        Binding(
            get: { appState[keyPath: keyPath] },
            set: { appState[keyPath: keyPath] = $0 }
        )
    }
}

private struct ShellStatusStrip: View {
    let presentation: ShellStatusPresentation

    var body: some View {
        GlassEffectContainer(spacing: 12) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(presentation.items) { item in
                        ShellStatusItemView(item: item)
                    }
                }
            }
        }
    }
}

private struct ShellStatusItemView: View {
    let item: ShellStatusPresentation.Item

    var body: some View {
        HStack(spacing: 10) {
            VersioneerStatusChip(
                title: item.title,
                tint: tint,
                systemImage: item.showsProgress ? nil : systemImage,
                showsProgress: item.showsProgress,
                glass: true
            )

            Text(item.detail)
                .font(.callout)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .versioneerCard(glass: true, cornerRadius: 20, padding: 14)
    }

    private var tint: Color {
        switch item.tone {
        case .progress:
            .accentColor
        case .success:
            .green
        case .warning:
            .orange
        case .failure:
            .red
        }
    }

    private var systemImage: String {
        switch item.tone {
        case .progress:
            "arrow.trianglehead.2.clockwise"
        case .success:
            "checkmark.circle.fill"
        case .warning:
            "sparkles"
        case .failure:
            "exclamationmark.triangle.fill"
        }
    }
}
