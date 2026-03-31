import Foundation
import Logging

/// Monitors directories for filesystem changes using GCD dispatch sources.
/// Coalesces rapid changes (e.g., during app installation) into a single notification
/// after a configurable delay.
@MainActor
final class DirectoryWatcher {
  private let sources: [DispatchSourceFileSystemObject]
  private let scheduler: DispatchSourceUserDataAdd

  /// Creates a watcher for the given directory URLs.
  /// - Parameters:
  ///   - urls: Directories to monitor for write events.
  ///   - coalesceDelay: Seconds to wait after the last change before firing. Defaults to 2.0.
  ///   - onChange: Called on the main queue when changes are detected.
  nonisolated init(
    urls: [URL],
    coalesceDelay: TimeInterval = 2.0,
    onChange: @MainActor @escaping @Sendable () -> Void
  ) {
    // Create coalescing scheduler — multiple add() calls collapse into one handler invocation
    let scheduler = DispatchSource.makeUserDataAddSource(queue: .global())
    self.scheduler = scheduler

    // Use a Sendable wrapper to avoid capturing @MainActor closure in GCD handler
    let callback = MainActorCallback(action: onChange)
    scheduler.setEventHandler {
      // Wait for rapid changes to settle (e.g., DMG copy, Sparkle extraction)
      Thread.sleep(forTimeInterval: coalesceDelay)
      callback.invoke()
    }

    // Create a dispatch source per directory
    var watchedSources: [DispatchSourceFileSystemObject] = []
    for url in urls {
      let descriptor = open((url as NSURL).fileSystemRepresentation, O_EVTONLY)
      guard descriptor != -1 else {
        Logger.appScanner.debug("Cannot watch directory: \(url.path)")
        continue
      }

      let source = DispatchSource.makeFileSystemObjectSource(
        fileDescriptor: descriptor,
        eventMask: .write,
        queue: .global()
      )
      source.setEventHandler { [weak scheduler] in
        scheduler?.add(data: 1)
      }
      source.setCancelHandler {
        close(descriptor)
      }

      watchedSources.append(source)
    }
    self.sources = watchedSources
  }

  /// Starts monitoring. Call once after init.
  func start() {
    scheduler.activate()
    for source in sources {
      source.activate()
    }
    Logger.appScanner.info("Watching \(sources.count) directories for changes")
  }

  deinit {
    scheduler.cancel()
    for source in sources {
      source.cancel()
    }
  }
}

/// Wraps a @MainActor closure so it can be safely stored and invoked from any isolation context.
private nonisolated final class MainActorCallback: Sendable {
  private let action: @MainActor @Sendable () -> Void

  init(action: @MainActor @Sendable @escaping () -> Void) {
    self.action = action
  }

  func invoke() {
    let action = self.action
    DispatchQueue.main.async {
      action()
    }
  }
}
