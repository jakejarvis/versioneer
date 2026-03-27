import SwiftUI

enum FeedbackType: String, CaseIterable, Identifiable {
  case wrongMatch = "Wrong Match"
  case wrongVersion = "Wrong Version"
  case missingApp = "Missing App"

  var id: String { rawValue }
}

struct FeedbackSheetView: View {
  @Binding var feedbackType: FeedbackType
  @Binding var feedbackComment: String
  @Binding var feedbackVersion: String
  @Binding var feedbackURL: String
  @Binding var feedbackSubmitting: Bool
  @Binding var feedbackError: String?
  @Binding var feedbackSuccess: Bool

  let onCancel: () -> Void
  let onSubmit: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      SectionHeader(
        title: "Report Issue",
        subtitle: "Send catalog feedback without leaving the desktop app."
      )

      Picker("Issue Type", selection: $feedbackType) {
        ForEach(FeedbackType.allCases) { type in
          Text(type.rawValue).tag(type)
        }
      }
      .pickerStyle(.segmented)

      feedbackBody

      TextField("Additional comments (optional)", text: $feedbackComment, axis: .vertical)
        .textFieldStyle(.roundedBorder)
        .lineLimit(4...6)

      if let feedbackError {
        Text(feedbackError)
          .font(.callout)
          .foregroundStyle(.red)
      }

      if feedbackSuccess {
        Label("Feedback submitted.", systemImage: "checkmark.circle.fill")
          .foregroundStyle(.green)
      }

      HStack {
        Spacer()

        Button("Cancel", action: onCancel)
          .keyboardShortcut(.cancelAction)

        Button("Submit", action: onSubmit)
          .buttonStyle(.glassProminent)
          .keyboardShortcut(.defaultAction)
          .disabled(feedbackSubmitting)
      }
    }
    .padding(20)
    .frame(minWidth: 440)
  }

  @ViewBuilder
  private var feedbackBody: some View {
    switch feedbackType {
    case .wrongMatch:
      Text("This app was matched to the wrong catalog entry.")
        .font(.callout)
        .foregroundStyle(.secondary)
    case .wrongVersion:
      VStack(alignment: .leading, spacing: 10) {
        Text("The latest version shown is incorrect.")
          .font(.callout)
          .foregroundStyle(.secondary)
        TextField("Correct latest version (optional)", text: $feedbackVersion)
          .textFieldStyle(.roundedBorder)
      }
    case .missingApp:
      VStack(alignment: .leading, spacing: 10) {
        Text("This app is not in the catalog and should be.")
          .font(.callout)
          .foregroundStyle(.secondary)
        TextField("Homepage URL (optional)", text: $feedbackURL)
          .textFieldStyle(.roundedBorder)
      }
    }
  }
}
