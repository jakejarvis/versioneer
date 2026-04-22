import SwiftUI

struct DetailReleaseNotesSection: View {
  @Environment(AppState.self) private var appState

  let result: AppDecision

  @State private var releaseNotes: ReleaseNotesContent?
  @State private var releaseNotesLoading = false

  @ViewBuilder
  var body: some View {
    DetailPlainSection(title: "What's New") {
      VStack(alignment: .leading, spacing: 12) {
        if releaseNotesLoading {
          HStack(spacing: 8) {
            ProgressView()
              .controlSize(.small)
            Text("Loading release notes...")
              .font(.callout)
              .foregroundStyle(.secondary)
          }
        } else if let releaseNotes {
          if let markdown = releaseNotes.markdown, !markdown.isEmpty {
            ReleaseNotesMarkdownView(markdown: markdown)
              .releaseNotesSurface()
          } else if let html = releaseNotes.html, !html.isEmpty {
            ReleaseNotesWebView(html: html)
              .releaseNotesSurface()
          } else {
            Text("No release notes available.")
              .font(.callout)
              .foregroundStyle(.secondary)
          }

          if let url = releaseNotes.url {
            Link("View Full Release Notes", destination: url)
              .buttonStyle(.link)
          }
        } else {
          Text("No release notes available.")
            .font(.callout)
            .foregroundStyle(.secondary)
        }
      }
    }
    .task(id: result.latestReleaseId) {
      await loadReleaseNotes()
    }
  }

  private func loadReleaseNotes() async {
    guard let releaseId = result.latestReleaseId else {
      releaseNotes = nil
      releaseNotesLoading = false
      return
    }
    releaseNotesLoading = true
    releaseNotes = nil
    let notes = await appState.fetchReleaseNotes(releaseId: releaseId)
    guard !Task.isCancelled else { return }
    releaseNotes = notes
    releaseNotesLoading = false
  }
}

extension View {
  fileprivate func releaseNotesSurface() -> some View {
    frame(minHeight: 100, maxHeight: 300)
      .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
          .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
      }
      .mask {
        VStack(spacing: 0) {
          Rectangle().fill(.black)
          LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
            .frame(height: 18)
        }
      }
  }
}
