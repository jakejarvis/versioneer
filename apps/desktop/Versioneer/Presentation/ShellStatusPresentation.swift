import Foundation

nonisolated struct ShellStatusPresentation: Equatable, Sendable {
    nonisolated struct Item: Equatable, Identifiable, Sendable {
        enum Tone: String, Sendable {
            case progress
            case success
            case warning
            case failure
        }

        let id: String
        let title: String
        let detail: String
        let tone: Tone
        let showsProgress: Bool
    }

    let items: [Item]

    @MainActor
    static func make(
        loadState: AppState.LoadState,
        scanSummary: AppState.ScanSummary,
        activeInstall: InstallCoordinator.OperationState?
    ) -> ShellStatusPresentation? {
        var items: [Item] = []

        switch loadState {
        case .scanning:
            items.append(Item(
                id: "scan",
                title: "Scanning Apps",
                detail: "Searching installed apps on disk.",
                tone: .progress,
                showsProgress: true
            ))
        case .submitting:
            items.append(Item(
                id: "submit",
                title: "Checking for Updates",
                detail: "Comparing \(scanSummary.totalApps) apps against the catalog.",
                tone: .progress,
                showsProgress: true
            ))
        case .error(let message):
            items.append(Item(
                id: "error",
                title: "Scan Failed",
                detail: message,
                tone: .failure,
                showsProgress: false
            ))
        case .idle, .done:
            break
        }

        if let activeInstall,
           activeInstall.phase != .idle,
           activeInstall.phase != .completed {
            items.append(Item(
                id: "install",
                title: activeInstall.appDisplayName.map { "\(activeInstall.phase.shellLabel) \($0)" } ?? activeInstall.phase.shellLabel,
                detail: activeInstall.errorMessage ?? activeInstall.detail,
                tone: activeInstall.phase == .failed ? .failure : .warning,
                showsProgress: activeInstall.isRunning
            ))
        }

        return items.isEmpty ? nil : ShellStatusPresentation(items: items)
    }
}

private extension InstallCoordinator.Phase {
    nonisolated
    var shellLabel: String {
        switch self {
        case .preparing:
            "Preparing"
        case .downloading:
            "Downloading"
        case .verifying:
            "Verifying"
        case .installing:
            "Installing"
        case .relaunching:
            "Relaunching"
        case .failed:
            "Install Failed"
        case .completed:
            "Install Complete"
        case .idle:
            "Idle"
        }
    }
}
