import AppKit
import SwiftUI
import Textual

struct ReleaseNotesMarkdownView: View {
  let markdown: String

  var body: some View {
    ScrollView {
      StructuredText(markdown: markdown)
        .textual.structuredTextStyle(.gitHub)
        .textual.textSelection(.enabled)
        .font(.callout)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .environment(
      \.openURL,
      OpenURLAction { url in
        guard Self.isSafeExternalURL(url) else { return .discarded }
        NSWorkspace.shared.open(url)
        return .handled
      })
  }

  private static func isSafeExternalURL(_ url: URL) -> Bool {
    guard let scheme = url.scheme?.lowercased() else { return false }
    return scheme == "http" || scheme == "https"
  }
}
