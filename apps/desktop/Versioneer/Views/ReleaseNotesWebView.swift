import AppKit
import SwiftUI

struct ReleaseNotesWebView: NSViewRepresentable {
  let html: String

  func makeNSView(context: Context) -> NSScrollView {
    let scrollView = NSScrollView()
    scrollView.drawsBackground = false
    scrollView.borderType = .noBorder
    scrollView.hasVerticalScroller = true
    scrollView.autohidesScrollers = true

    let textView = NSTextView(frame: .zero)
    textView.isEditable = false
    textView.isSelectable = true
    textView.isRichText = true
    textView.drawsBackground = false
    textView.allowsUndo = false
    textView.textContainerInset = NSSize(width: 12, height: 12)
    textView.textContainer?.lineFragmentPadding = 0
    textView.textContainer?.widthTracksTextView = true
    textView.isHorizontallyResizable = false
    textView.isVerticallyResizable = true
    textView.minSize = .zero
    textView.maxSize = NSSize(
      width: CGFloat.greatestFiniteMagnitude,
      height: CGFloat.greatestFiniteMagnitude
    )
    textView.delegate = context.coordinator
    textView.linkTextAttributes = [
      .foregroundColor: NSColor.linkColor,
      .underlineStyle: NSUnderlineStyle.single.rawValue,
    ]

    scrollView.documentView = textView
    updateTextView(textView, context: context)
    return scrollView
  }

  func updateNSView(_ scrollView: NSScrollView, context: Context) {
    guard let textView = scrollView.documentView as? NSTextView else { return }
    updateTextView(textView, context: context)
  }

  func makeCoordinator() -> Coordinator {
    Coordinator()
  }

  private func updateTextView(_ textView: NSTextView, context: Context) {
    guard html != context.coordinator.lastLoadedHTML else { return }
    textView.textStorage?.setAttributedString(makeAttributedString())
    context.coordinator.lastLoadedHTML = html
  }

  private func makeAttributedString() -> NSAttributedString {
    let wrapped = """
      <!DOCTYPE html>
      <html>
      <head>
      <meta charset="utf-8">
      <style>
          body {
              font-family: -apple-system, BlinkMacSystemFont, sans-serif;
              font-size: 13px;
              line-height: 1.45;
              color: -apple-system-label;
              margin: 12px;
              word-wrap: break-word;
          }
          h1 { font-size: 1.3em; margin: 0.8em 0 0.4em; }
          h2 { font-size: 1.15em; margin: 0.6em 0 0.3em; }
          h3 { font-size: 1em; margin: 0.4em 0 0.2em; }
          ul, ol { padding-left: 1.5em; margin: 0.4em 0; }
          li { margin: 0.15em 0; }
          p { margin: 0.4em 0; }
          a { color: -apple-system-blue; }
          code {
              font-family: Menlo, monospace;
              font-size: 0.9em;
              background: rgba(128, 128, 128, 0.12);
              padding: 0.15em 0.3em;
              border-radius: 3px;
          }
          pre {
              background: rgba(128, 128, 128, 0.12);
              padding: 8px;
              border-radius: 5px;
              overflow-x: auto;
          }
          pre code { background: none; padding: 0; }
          blockquote {
              border-left: 3px solid rgba(128, 128, 128, 0.3);
              padding-left: 10px;
              margin-left: 0;
              color: rgba(128, 128, 128, 0.8);
          }
          img { max-width: 100%; height: auto; }
          @media (prefers-color-scheme: dark) {
              body { color: #e0e0e0; }
          }
      </style>
      </head>
      <body>\(html)</body>
      </html>
      """

    guard let data = wrapped.data(using: .utf8) else {
      return NSAttributedString(string: html)
    }

    let options: [NSAttributedString.DocumentReadingOptionKey: Any] = [
      .documentType: NSAttributedString.DocumentType.html,
      .characterEncoding: String.Encoding.utf8.rawValue,
    ]

    guard
      let attributedString = try? NSMutableAttributedString(
        data: data,
        options: options,
        documentAttributes: nil
      )
    else {
      return NSAttributedString(string: html)
    }

    sanitizeAttachments(in: attributedString)
    sanitizeLinks(in: attributedString)
    return attributedString
  }

  private func sanitizeAttachments(in attributedString: NSMutableAttributedString) {
    let fullRange = NSRange(location: 0, length: attributedString.length)
    var attachmentRanges: [NSRange] = []

    attributedString.enumerateAttribute(.attachment, in: fullRange) { value, range, _ in
      guard value != nil else { return }
      attachmentRanges.append(range)
    }

    for range in attachmentRanges.reversed() {
      attributedString.replaceCharacters(in: range, with: "")
    }
  }

  private func sanitizeLinks(in attributedString: NSMutableAttributedString) {
    let fullRange = NSRange(location: 0, length: attributedString.length)
    attributedString.enumerateAttribute(.link, in: fullRange) { value, range, _ in
      guard
        let value,
        let url = Self.normalizedURL(from: value),
        Self.isSafeExternalURL(url)
      else {
        attributedString.removeAttribute(.link, range: range)
        return
      }

      attributedString.addAttribute(.link, value: url, range: range)
    }
  }

  private static func normalizedURL(from value: Any) -> URL? {
    if let url = value as? URL {
      return url
    }

    if let string = value as? String {
      return URL(string: string)
    }

    return nil
  }

  private static func isSafeExternalURL(_ url: URL) -> Bool {
    guard let scheme = url.scheme?.lowercased() else { return false }
    return scheme == "http" || scheme == "https"
  }

  final class Coordinator: NSObject, NSTextViewDelegate {
    var lastLoadedHTML: String?

    func textView(_ textView: NSTextView, clickedOnLink link: Any, at charIndex: Int) -> Bool {
      guard
        let url = ReleaseNotesWebView.normalizedURL(from: link),
        ReleaseNotesWebView.isSafeExternalURL(url)
      else {
        return true
      }

      NSWorkspace.shared.open(url)
      return true
    }
  }
}
