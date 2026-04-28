import Foundation
import Logging

/// Submits user feedback about incorrect matches or versions.
nonisolated struct FeedbackAPIClient: Sendable {
  let baseURL: URL

  init(baseURL: URL) {
    self.baseURL = baseURL
  }

  func submitWrongMatch(_ feedback: FeedbackRequest.WrongMatch) async throws {
    try await post(body: Self.submitRequest(for: feedback))
  }

  func submitWrongVersion(_ feedback: FeedbackRequest.WrongVersion) async throws {
    try await post(body: Self.submitRequest(for: feedback))
  }

  func submitMissingApp(_ feedback: FeedbackRequest.MissingApp) async throws {
    try await post(body: Self.submitRequest(for: feedback))
  }

  static func submitRequest(
    for feedback: FeedbackRequest.WrongMatch
  ) -> SubmitRequest<CommentPayload> {
    SubmitRequest(
      feedbackType: "wrong_match",
      bundleId: feedback.bundleId,
      appName: feedback.appName,
      matchedAppId: feedback.matchedAppId,
      payload: CommentPayload(comment: feedback.comment)
    )
  }

  static func submitRequest(
    for feedback: FeedbackRequest.WrongVersion
  ) -> SubmitRequest<WrongVersionPayload> {
    SubmitRequest(
      feedbackType: "wrong_version",
      bundleId: feedback.bundleId,
      appName: feedback.appName,
      matchedAppId: feedback.matchedAppId,
      payload: WrongVersionPayload(
        reportedLatestVersion: feedback.reportedLatestVersion,
        comment: feedback.comment
      )
    )
  }

  static func submitRequest(
    for feedback: FeedbackRequest.MissingApp
  ) -> SubmitRequest<MissingAppPayload> {
    SubmitRequest(
      feedbackType: "app_request",
      bundleId: feedback.bundleId,
      appName: feedback.appName,
      matchedAppId: nil,
      payload: MissingAppPayload(homepageUrl: feedback.homepageUrl, comment: feedback.comment)
    )
  }

  private func post<T: Encodable>(body: T) async throws {
    let endpoint = baseURL.appendingPathComponent("v1/feedback")
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(body)

    Logger.feedback.info("Submitting feedback to \(endpoint.absoluteString)")

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse else {
      throw APIError.invalidResponse
    }

    guard (200...299).contains(httpResponse.statusCode) else {
      let body = String(data: data, encoding: .utf8) ?? ""
      Logger.feedback.error("Feedback API returned \(httpResponse.statusCode): \(body)")
      throw APIError.httpError(statusCode: httpResponse.statusCode, body: body)
    }
  }

  struct SubmitRequest<Payload: Codable & Sendable>: Codable, Sendable {
    let feedbackType: String
    let bundleId: String?
    let appName: String?
    let matchedAppId: String?
    let payload: Payload
  }

  struct CommentPayload: Codable, Equatable, Sendable {
    let comment: String?
  }

  struct WrongVersionPayload: Codable, Equatable, Sendable {
    let reportedLatestVersion: String?
    let comment: String?
  }

  struct MissingAppPayload: Codable, Equatable, Sendable {
    let homepageUrl: String?
    let comment: String?
  }
}
