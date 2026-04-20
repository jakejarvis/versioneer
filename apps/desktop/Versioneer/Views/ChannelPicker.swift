import SwiftUI

struct ChannelPicker: View {
  @Environment(AppState.self) private var appState

  let result: AppDecision

  private var channels: [String] {
    result.availableChannels ?? ["stable"]
  }

  private var currentChannel: String {
    guard let appId = result.matchedAppId else { return "stable" }
    return appState.settings.channel(forAppId: appId)
  }

  private var channelTint: Color {
    switch currentChannel {
    case "stable": .secondary
    case "beta": .orange
    case "nightly": .purple
    default: .blue
    }
  }

  var body: some View {
    if channels.count > 1 {
      Menu {
        ForEach(channels, id: \.self) { channel in
          Button {
            setChannel(channel)
          } label: {
            if channel == currentChannel {
              Label(channel.capitalized, systemImage: "checkmark")
            } else {
              Text(channel.capitalized)
            }
          }
        }
      } label: {
        StatusChip(
          title: currentChannel.capitalized,
          tint: channelTint,
          systemImage: "antenna.radiowaves.left.and.right",
          interactive: true
        )
      }
      .menuStyle(.borderlessButton)
      .fixedSize()
    } else if let channel = result.channel, channel != "stable" {
      StatusChip(
        title: channel.capitalized,
        tint: channelTint,
        systemImage: "antenna.radiowaves.left.and.right"
      )
    }
  }

  private func setChannel(_ channel: String) {
    guard let appId = result.matchedAppId else { return }
    if channel == "stable" {
      appState.settings.removeChannelOverride(forAppId: appId)
    } else {
      appState.settings.setChannel(channel, forAppId: appId)
    }
  }
}
