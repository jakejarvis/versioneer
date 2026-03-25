import Foundation
import OSLog

/// Submits user feedback about incorrect matches or versions.
struct FeedbackAPIClient: Sendable {
    let baseURL: URL

    init(baseURL: URL) {
        self.baseURL = baseURL
    }

    func submitWrongMatch(_ feedback: FeedbackRequest.WrongMatch) async throws {
        try await post(path: "v1/feedback/match", body: feedback)
    }

    func submitWrongVersion(_ feedback: FeedbackRequest.WrongVersion) async throws {
        try await post(path: "v1/feedback/version", body: feedback)
    }

    func submitMissingApp(_ feedback: FeedbackRequest.MissingApp) async throws {
        try await post(path: "v1/feedback/missing-app", body: feedback)
    }

    private func post<T: Encodable>(path: String, body: T) async throws {
        let endpoint = baseURL.appendingPathComponent(path)
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
}
