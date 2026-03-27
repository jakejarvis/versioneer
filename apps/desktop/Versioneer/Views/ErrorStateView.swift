import SwiftUI

struct ErrorStateView: View {
  let message: String
  var retryAction: (() -> Void)?

  var body: some View {
    ContentUnavailableView {
      Label("Something Went Wrong", systemImage: "exclamationmark.triangle")
    } description: {
      Text(message)
    } actions: {
      if let retryAction {
        Button("Try Again", action: retryAction)
          .buttonStyle(.borderedProminent)
      }
    }
  }
}
