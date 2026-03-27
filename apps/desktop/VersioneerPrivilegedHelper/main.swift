import Darwin
import Foundation

private final class PrivilegedHelperListenerDelegate: NSObject, NSXPCListenerDelegate {
  func listener(_ listener: NSXPCListener, shouldAcceptNewConnection newConnection: NSXPCConnection)
    -> Bool
  {
    guard let homeDirectory = homeDirectory(for: newConnection.effectiveUserIdentifier) else {
      return false
    }

    newConnection.exportedInterface = NSXPCInterface(with: PrivilegedInstallerXPCProtocol.self)
    newConnection.exportedObject = PrivilegedHelperService(
      validator: PrivilegedOperationValidator(
        allowedStagingRoot: PrivilegedInstallPaths.stagingRoot(in: homeDirectory)
      )
    )
    newConnection.resume()
    return true
  }

  private func homeDirectory(for userIdentifier: uid_t) -> URL? {
    guard let passwordEntry = getpwuid(userIdentifier) else { return nil }
    guard let directoryCString = passwordEntry.pointee.pw_dir else { return nil }
    return URL(
      fileURLWithFileSystemRepresentation: directoryCString, isDirectory: true, relativeTo: nil)
  }
}

let listener = NSXPCListener(machServiceName: PrivilegedHelperConstants.serviceLabel)
private let delegate = PrivilegedHelperListenerDelegate()
if #available(macOS 13.0, *) {
  listener.setConnectionCodeSigningRequirement(
    PrivilegedHelperConstants.mainAppCodeSigningRequirement)
}
listener.delegate = delegate
listener.resume()
RunLoop.main.run()
