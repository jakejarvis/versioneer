import AppKit
import SwiftUI

struct ReleaseNotesMarkdownView: View {
  let markdown: String

  var body: some View {
    ScrollView {
      Text(renderedMarkdown)
        .font(.callout)
        .textSelection(.enabled)
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

  private var renderedMarkdown: AttributedString {
    do {
      return try AttributedString(
        markdown: markdown,
        options: .init(interpretedSyntax: .full)
      )
    } catch {
      return AttributedString(markdown)
    }
  }

  private static func isSafeExternalURL(_ url: URL) -> Bool {
    guard let scheme = url.scheme?.lowercased() else { return false }
    return (scheme == "http" || scheme == "https") && url.host != nil
  }
}
