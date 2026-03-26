import Foundation
import Logging

/// Submits app inventory to the backend and decodes update decisions.
struct InventoryAPIClient: Sendable {
    let baseURL: URL

    init(baseURL: URL) {
        self.baseURL = baseURL
    }

    /// Submits inventory and returns the decoded response.
    func checkInventory(apps: [InstalledApp], scanDurationMs: Int?) async throws -> InventoryCheckResponse {
        let endpoint = baseURL.appendingPathComponent("v1/inventory/check")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let payload = buildRequest(from: apps, scanDurationMs: scanDurationMs)

        let encoder = JSONEncoder()
        request.httpBody = try encoder.encode(payload)

        Logger.api.info("Submitting inventory with \(apps.count) apps to \(endpoint.absoluteString)")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard httpResponse.statusCode == 200 else {
            let body = String(data: data, encoding: .utf8) ?? ""
            Logger.api.error("API returned status \(httpResponse.statusCode): \(body)")
            throw APIError.httpError(statusCode: httpResponse.statusCode, body: body)
        }

        let decoder = JSONDecoder()
        do {
            return try decoder.decode(InventoryCheckResponse.self, from: data)
        } catch {
            Logger.api.error("Failed to decode response: \(error.localizedDescription)")
            throw APIError.decodingFailed(error.localizedDescription)
        }
    }

    private func buildRequest(from apps: [InstalledApp], scanDurationMs: Int?) -> InventoryCheckRequest {
        let installId = installIdentifier()
        let osVersion = ProcessInfo.processInfo.operatingSystemVersionString
        let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String

        let inventoryApps = apps.map { app in
            InventoryCheckRequest.InventoryApp(
                appName: app.name,
                bundleId: app.bundleId,
                version: app.version,
                buildNumber: app.buildNumber,
                teamId: app.teamId,
                pathHash: pathHash(app.path),
                architecture: app.architecture
            )
        }

        return InventoryCheckRequest(
            client: .init(
                installId: installId,
                platform: "macos",
                appVersion: appVersion,
                osVersion: osVersion
            ),
            apps: inventoryApps,
            scanDurationMs: scanDurationMs
        )
    }

    /// A stable per-machine identifier stored in UserDefaults.
    private func installIdentifier() -> String {
        let key = "versioneer_install_id"
        if let existing = UserDefaults.standard.string(forKey: key) {
            return existing
        }
        let newId = UUID().uuidString
        UserDefaults.standard.set(newId, forKey: key)
        return newId
    }

    /// Simple hash of the app path for deduplication on the backend.
    private func pathHash(_ path: String) -> String {
        var hasher = Hasher()
        hasher.combine(path)
        let hash = hasher.finalize()
        return String(format: "%08x", abs(hash))
    }
}

enum APIError: LocalizedError, Sendable {
    case invalidResponse
    case httpError(statusCode: Int, body: String)
    case decodingFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            "Invalid response from server"
        case .httpError(let statusCode, _):
            "Server returned status \(statusCode)"
        case .decodingFailed(let message):
            "Failed to decode response: \(message)"
        }
    }
}
