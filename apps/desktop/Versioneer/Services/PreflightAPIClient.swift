import Foundation
import Logging

/// Fetches client preflight configuration from the backend.
nonisolated struct PreflightAPIClient: Sendable {
  let baseURL: URL

  init(baseURL: URL) {
    self.baseURL = baseURL
  }

  /// Fetches the preflight config including server-dismissed bundle IDs.
  func fetchPreflight() async throws -> PreflightResponse {
    let endpoint = baseURL.appendingPathComponent("v1/client/preflight")
    var request = URLRequest(url: endpoint)
    request.httpMethod = "GET"
    request.setValue("application/json", forHTTPHeaderField: "Accept")

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse else {
      throw APIError.invalidResponse
    }

    guard httpResponse.statusCode == 200 else {
      let body = String(data: data, encoding: .utf8) ?? ""
      Logger.api.error("Preflight API returned \(httpResponse.statusCode): \(body)")
      throw APIError.httpError(statusCode: httpResponse.statusCode, body: body)
    }

    do {
      return try JSONDecoder().decode(PreflightResponse.self, from: data)
    } catch {
      throw APIError.decodingFailed(error.localizedDescription)
    }
  }
}
