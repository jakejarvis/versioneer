import Foundation

/// Hard-coded bundle IDs that are always excluded from scan results.
/// These are helpers, uninstallers, updaters, and system utilities —
/// not meaningful standalone apps worth tracking.
nonisolated enum GloballyIgnoredApps {
  static let bundleIds: Set<String> = [
    // Adobe helpers & uninstallers
    "com.adobe.acc.AdobeCreativeCloud",
    "com.adobe.accmac.ACCFinderSync",
    "com.adobe.AdobeCreativeCloudCleanerTool",
    "com.adobe.Uninstaller",
    "com.adobe.Installers.Setup",

    // Microsoft updaters & helpers
    "com.microsoft.autoupdate2",
    "MSau04",
    "com.microsoft.errorreporting",
    "com.microsoft.netlib.shipassertprocess",

    // Google updaters
    "com.google.keystone.agent",
    "com.google.GoogleUpdater",
    "com.google.SoftwareUpdate",

    // JetBrains Toolbox helper
    "com.jetbrains.toolbox.linkhandler",

    // Electron shell (not a real app)
    "com.github.Electron",
    "com.github.Electron.helper",

    // Misc uninstallers & helpers
    "com.parallels.desktop.console.unmounter",
    "com.bombich.ccc.MigrationHelper",
    "com.wacom.RemoveWacomTablet",
    "com.citrix.ReceiverUninstaller",
    "com.logitech.UnifyingReceiver",
  ]

  static func shouldIgnore(bundleId: String?) -> Bool {
    guard let bundleId else { return false }
    return bundleIds.contains(bundleId)
  }
}
