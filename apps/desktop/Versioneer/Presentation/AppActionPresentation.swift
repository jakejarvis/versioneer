import Foundation

nonisolated struct ManualUpdateAction: Equatable, Sendable {
  let title: String
  let detail: String
  let url: URL
}

nonisolated enum PrimaryAppActionKind: Equatable, Sendable {
  case stopIgnoring
  case openApp
  case install
  case masUpgrade
  case brewUpgrade
  case manualUpdate
  case unavailable

  var performsUpdate: Bool {
    switch self {
    case .install, .masUpgrade, .brewUpgrade, .manualUpdate:
      true
    case .stopIgnoring, .openApp, .unavailable:
      false
    }
  }
}

nonisolated struct PrimaryAppActionPresentation: Equatable, Sendable {
  let kind: PrimaryAppActionKind
  let title: String
  let compactTitle: String
  let systemImage: String
  let isDisabled: Bool
  let showsSecondaryOpenButton: Bool
  let requiresInstallWarning: Bool
  let hasUpdateAction: Bool

  @MainActor
  static func make(
    result: InventoryResult,
    installState: InstallCoordinator.OperationState,
    isUserIgnored: Bool,
    isHomebrewInstalled: Bool,
    isMasUpgradeable: Bool,
    hasAppPath: Bool,
    manualUpdateAction: ManualUpdateAction?
  ) -> PrimaryAppActionPresentation {
    let hasUpdateAction =
      result.decision == .updateAvailable
      && (isMasUpgradeable || isHomebrewInstalled || result.canInstall || manualUpdateAction != nil)
    let showsSecondaryOpenButton =
      !installState.isRunning && hasUpdateAction && hasAppPath && !isUserIgnored

    if isUserIgnored {
      return PrimaryAppActionPresentation(
        kind: .stopIgnoring,
        title: "Stop Ignoring",
        compactTitle: "Unignore",
        systemImage: "minus.circle",
        isDisabled: false,
        showsSecondaryOpenButton: false,
        requiresInstallWarning: false,
        hasUpdateAction: hasUpdateAction
      )
    }

    if installState.phase == .completed || result.decision != .updateAvailable {
      return PrimaryAppActionPresentation(
        kind: .openApp,
        title: "Open App",
        compactTitle: "Open",
        systemImage: "macwindow",
        isDisabled: !hasAppPath,
        showsSecondaryOpenButton: showsSecondaryOpenButton,
        requiresInstallWarning: false,
        hasUpdateAction: hasUpdateAction
      )
    }

    if installState.phase == .failed {
      let routeKind = updateRouteKind(
        result: result,
        isHomebrewInstalled: isHomebrewInstalled,
        isMasUpgradeable: isMasUpgradeable,
        manualUpdateAction: manualUpdateAction
      )
      return PrimaryAppActionPresentation(
        kind: routeKind,
        title: "Retry Install",
        compactTitle: "Update",
        systemImage: "arrow.clockwise",
        isDisabled: !hasUpdateAction,
        showsSecondaryOpenButton: showsSecondaryOpenButton,
        requiresInstallWarning: routeKind == .install && !result.isVerified,
        hasUpdateAction: hasUpdateAction
      )
    }

    if isMasUpgradeable {
      return PrimaryAppActionPresentation(
        kind: .masUpgrade,
        title: "Update via Mac App Store",
        compactTitle: "Update",
        systemImage: "apple.logo",
        isDisabled: installState.isRunning,
        showsSecondaryOpenButton: showsSecondaryOpenButton,
        requiresInstallWarning: false,
        hasUpdateAction: hasUpdateAction
      )
    }

    if isHomebrewInstalled {
      return PrimaryAppActionPresentation(
        kind: .brewUpgrade,
        title: "Update via Homebrew",
        compactTitle: "Update",
        systemImage: "mug.fill",
        isDisabled: installState.isRunning,
        showsSecondaryOpenButton: showsSecondaryOpenButton,
        requiresInstallWarning: false,
        hasUpdateAction: hasUpdateAction
      )
    }

    if result.canInstall {
      let installPresentation = InstallPresentation.make(result: result, state: installState)
      return PrimaryAppActionPresentation(
        kind: .install,
        title: installPresentation.primaryActionTitle,
        compactTitle: "Update",
        systemImage: "arrow.down.circle",
        isDisabled: installState.isRunning,
        showsSecondaryOpenButton: showsSecondaryOpenButton,
        requiresInstallWarning: !result.isVerified,
        hasUpdateAction: hasUpdateAction
      )
    }

    if let manualUpdateAction {
      return PrimaryAppActionPresentation(
        kind: .manualUpdate,
        title: manualUpdateAction.title,
        compactTitle: "Open",
        systemImage: "arrow.up.forward.app",
        isDisabled: installState.isRunning,
        showsSecondaryOpenButton: showsSecondaryOpenButton,
        requiresInstallWarning: false,
        hasUpdateAction: hasUpdateAction
      )
    }

    return PrimaryAppActionPresentation(
      kind: .unavailable,
      title: "Install Unavailable",
      compactTitle: "Update",
      systemImage: "arrow.down.circle",
      isDisabled: true,
      showsSecondaryOpenButton: showsSecondaryOpenButton,
      requiresInstallWarning: false,
      hasUpdateAction: hasUpdateAction
    )
  }

  private static func updateRouteKind(
    result: InventoryResult,
    isHomebrewInstalled: Bool,
    isMasUpgradeable: Bool,
    manualUpdateAction: ManualUpdateAction?
  ) -> PrimaryAppActionKind {
    if isMasUpgradeable {
      return .masUpgrade
    }
    if isHomebrewInstalled {
      return .brewUpgrade
    }
    if result.canInstall {
      return .install
    }
    if manualUpdateAction != nil {
      return .manualUpdate
    }
    return .unavailable
  }
}

extension InstallStrategy {
  nonisolated var displayTitle: String {
    switch self {
    case .sparkle:
      "Sparkle"
    case .zipReplace:
      "Extract"
    case .dmgCopyReplace:
      "DMG Mount"
    case .pkgInstall:
      "Installer"
    case .macAppStore:
      "Mac App Store"
    case .manualOnly:
      "Manual"
    }
  }
}
