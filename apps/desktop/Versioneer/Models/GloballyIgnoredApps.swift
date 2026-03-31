import Foundation

/// Hard-coded bundle IDs that are always excluded from scan results.
/// These are helpers, uninstallers, updaters, and system utilities —
/// not meaningful standalone apps worth tracking.
nonisolated enum GloballyIgnoredApps {
  static let bundleIds: Set<String> = [
    // Apple system utilities & agents
    "com.apple.AccessibilityUIServer",
    "com.apple.accessibility.AXVisualSupportAgent",
    "com.apple.accessibility.universalAccessAuthWarn",
    "com.apple.AirPlayUIAgent",
    "com.apple.AppSSOAgent",
    "com.apple.backgroundtaskmanagement.agent",
    "com.apple.CharacterPaletteIM",
    "com.apple.controlcenter",
    "com.apple.CoreLocationAgent",
    "com.apple.coreservices.uiagent",
    "com.apple.dock",
    "com.apple.finder",
    "com.apple.loginwindow",
    "com.apple.nbagent",
    "com.apple.Notes",
    "com.apple.notificationcenterui",
    "com.apple.PowerChime",
    "com.apple.PreviewShellMac",
    "com.apple.security.Keychain-Circle-Notification",
    "com.apple.Siri",
    "com.apple.SoftwareUpdateNotificationManager",
    "com.apple.Spotlight",
    "com.apple.storeuid",
    "com.apple.systemuiserver",
    "com.apple.TextInputMenuAgent",
    "com.apple.TextInputSwitcher",
    "com.apple.UIKitSystemApp",
    "com.apple.universalcontrol",
    "com.apple.UserNotificationCenter",
    "com.apple.wallpaper.agent",
    "com.apple.wifi.WiFiAgent",
    "com.apple.WindowManager",

    // Apple script apps
    "com.apple.ScriptEditor.id.Contact-Sheets",
    "com.apple.ScriptEditor.id.Make-Calendar",
    "com.apple.ScriptEditor.id.Web-Gallery",

    // Adobe helpers, uninstallers & daemons
    "com.adobe.acc.AdobeCreativeCloud",
    "com.adobe.acc.AdobeDesktopService",
    "com.adobe.accmac",
    "com.adobe.accmac.ACCFinderSync",
    "com.adobe.ACCC.Uninstaller",
    "com.adobe.AdobeCreativeCloudCleanerTool",
    "com.adobe.AdobeCRDaemon",
    "com.adobe.AdobeIPCBroker",
    "com.adobe.AdobeResourceSynchronizer",
    "com.adobe.cc.Adobe-Creative-Cloud-Diagnostics",
    "com.adobe.ccd.helper",
    "com.adobe.CCXProcess",
    "com.adobe.distiller",
    "com.adobe.gcclient",
    "com.adobe.Install",
    "com.adobe.Installers.Setup",
    "com.adobe.Uninstaller",
    "GoCart.gcuninstaller",

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

    // Third-party agents & helpers
    "2BUA8C4S2C.com.1password.browser-helper",
    "com.anthropic.claude-code-url-handler",
    "com.backblaze.bzbmenu",
    "com.figma.agent",
    "com.todesktop.230313mzl4w4u92.helper",
    "at.obdev.littlesnitch.agent",
    "net.imput.helium.helper",

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
