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
    NavigationStack {
      Form {
        Section {
          Picker("Issue Type", selection: $feedbackType) {
            ForEach(FeedbackType.allCases) { type in
              Text(type.rawValue).tag(type)
            }
          }
          .pickerStyle(.segmented)
        }

        Section {
          feedbackBody

          TextField("Additional comments (optional)", text: $feedbackComment, axis: .vertical)
            .lineLimit(4...6)
        } footer: {
          Text("Send catalog feedback without leaving the desktop app.")
        }

        if let feedbackError {
          Section {
            Text(feedbackError)
              .font(.callout)
              .foregroundStyle(.red)
          }
        }

        if feedbackSuccess {
          Section {
            Label("Thank you for your feedback.", systemImage: "checkmark.circle.fill")
              .foregroundStyle(.green)
          }
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Report Issue")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", action: onCancel)
            .keyboardShortcut(.cancelAction)
        }

        ToolbarItem(placement: .confirmationAction) {
          Button("Submit", action: onSubmit)
            .keyboardShortcut(.defaultAction)
            .disabled(feedbackSubmitting)
        }
      }
    }
    .frame(minWidth: 480, minHeight: 360)
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
      }
    case .missingApp:
      VStack(alignment: .leading, spacing: 10) {
        Text("This app is not in the catalog and should be.")
          .font(.callout)
          .foregroundStyle(.secondary)
        TextField("Homepage URL (optional)", text: $feedbackURL)
      }
    }
  }
}
