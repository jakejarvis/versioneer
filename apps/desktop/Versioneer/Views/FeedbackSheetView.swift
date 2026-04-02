import SwiftUI

enum FeedbackType: String, CaseIterable, Identifiable {
  case wrongMatch = "Wrong Match"
  case wrongVersion = "Wrong Version"
  case missingApp = "Missing App"

  var id: String { rawValue }
}

struct FeedbackSheetView: View {
  @Environment(AppState.self) private var appState
  @Environment(\.dismiss) private var dismiss

  let result: AppDecision

  @State private var feedbackType: FeedbackType = .wrongMatch
  @State private var comment = ""
  @State private var version = ""
  @State private var url = ""
  @State private var isSubmitting = false
  @State private var error: String?
  @State private var success = false

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
          feedbackFields

          TextField("Additional comments (optional)", text: $comment, axis: .vertical)
            .lineLimit(4...6)
        } footer: {
          Text("Send catalog feedback without leaving the desktop app.")
        }

        if let error {
          Section {
            Text(error)
              .font(.callout)
              .foregroundStyle(.red)
          }
        }

        if success {
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
          Button("Cancel") { dismiss() }
            .keyboardShortcut(.cancelAction)
        }

        ToolbarItem(placement: .confirmationAction) {
          Button("Submit", action: submit)
            .keyboardShortcut(.defaultAction)
            .disabled(isSubmitting)
        }
      }
    }
    .frame(minWidth: 480, minHeight: 360)
    .onChange(of: success) {
      guard success else { return }
      Task {
        try? await Task.sleep(for: .seconds(2))
        dismiss()
      }
    }
  }

  @ViewBuilder
  private var feedbackFields: some View {
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
        TextField("Correct latest version (optional)", text: $version)
      }
    case .missingApp:
      VStack(alignment: .leading, spacing: 10) {
        Text("This app is not in the catalog and should be.")
          .font(.callout)
          .foregroundStyle(.secondary)
        TextField("Homepage URL (optional)", text: $url)
      }
    }
  }

  // MARK: - Actions

  private func submit() {
    Task { await submitAsync() }
  }

  private func submitAsync() async {
    isSubmitting = true
    error = nil

    do {
      switch feedbackType {
      case .wrongMatch:
        try await appState.submitWrongMatch(
          for: result,
          comment: comment.isEmpty ? nil : comment
        )
      case .wrongVersion:
        try await appState.submitWrongVersion(
          for: result,
          reportedVersion: version.isEmpty ? nil : version,
          comment: comment.isEmpty ? nil : comment
        )
      case .missingApp:
        try await appState.submitMissingApp(
          for: result,
          homepageUrl: url.isEmpty ? nil : url,
          comment: comment.isEmpty ? nil : comment
        )
      }
      success = true
    } catch {
      self.error = error.localizedDescription
    }

    isSubmitting = false
  }
}
