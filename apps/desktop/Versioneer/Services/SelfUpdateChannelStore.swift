import Foundation

struct SelfUpdateChannelStore {
  static let defaultsKey = "versioneer_self_update_channel"

  private let defaults: UserDefaults
  private let bundle: Bundle

  init(defaults: UserDefaults = .standard, bundle: Bundle = .main) {
    self.defaults = defaults
    self.bundle = bundle
  }

  var channel: SelfUpdateChannel {
    mutating get {
      if let storedChannel = storedChannel {
        return storedChannel
      }

      let initialChannel = defaultChannelFromBundle
      defaults.set(initialChannel.rawValue, forKey: Self.defaultsKey)
      return initialChannel
    }
    set {
      defaults.set(newValue.rawValue, forKey: Self.defaultsKey)
    }
  }

  var storedChannel: SelfUpdateChannel? {
    guard let rawValue = defaults.string(forKey: Self.defaultsKey) else {
      return nil
    }

    return SelfUpdateChannel(rawValue: rawValue)
  }

  var defaultChannelFromBundle: SelfUpdateChannel {
    let bundleValue =
      bundle.object(forInfoDictionaryKey: SelfUpdateChannel.bundleInfoKey) as? String
    return SelfUpdateChannel.fromBundleValue(bundleValue) ?? .stable
  }
}
