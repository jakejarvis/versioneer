import SwiftUI
import WebKit

struct ReleaseNotesWebView: NSViewRepresentable {
    let html: String

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.preferences.isElementFullscreenEnabled = false
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")
        loadHTML(in: webView)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        loadHTML(in: webView)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    private func loadHTML(in webView: WKWebView) {
        let wrapped = """
        <!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8">
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                font-size: 13px;
                line-height: 1.55;
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
        webView.loadHTMLString(wrapped, baseURL: nil)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
        ) {
            if navigationAction.navigationType == .linkActivated,
               let url = navigationAction.request.url
            {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }
    }
}
