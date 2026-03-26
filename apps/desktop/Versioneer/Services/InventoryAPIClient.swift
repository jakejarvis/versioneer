import CryptoKit
import Foundation
import Logging

/// Submits app inventory to the backend and decodes update decisions.
nonisolated struct InventoryAPIClient: Sendable {
    let baseURL: URL

    init(baseURL: URL) {
        self.baseURL = baseURL
    }

    /// Response from the release notes endpoint.
    struct ReleaseNotesResponse: Codable, Sendable {
        let releaseId: String
        let appId: String
        let versionRaw: String
        let releaseNotesHtml: String?
    }

    /// Fetches release notes HTML for a specific release.
    func fetchReleaseNotes(releaseId: String) async throws -> ReleaseNotesResponse {
        let endpoint = baseURL.appendingPathComponent("v1/releases/\(releaseId)/notes")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard httpResponse.statusCode == 200 else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw APIError.httpError(statusCode: httpResponse.statusCode, body: body)
        }

        do {
            return try JSONDecoder().decode(ReleaseNotesResponse.self, from: data)
        } catch {
            throw APIError.decodingFailed(error.localizedDescription)
        }
    }

    /// Requests a server-issued install plan for a specific app/release.
    func prepareInstall(
        snapshotId: String,
        result: AppDecision,
        installedApp: InstalledApp
    ) async throws -> InstallPrepareResponse {
        guard let matchedAppId = result.matchedAppId,
              let releaseId = result.latestReleaseId,
              let strategy = result.install.strategy else {
            throw APIError.installNotAvailable
        }

        let endpoint = baseURL.appendingPathComponent("v1/install/prepare")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let payload = InstallPrepareRequest(
            installId: installIdentifier(),
            snapshotId: snapshotId,
            matchedAppId: matchedAppId,
            releaseId: releaseId,
            installedVersion: result.installedVersion,
            localAppPath: installedApp.path,
            strategyCandidate: strategy
        )

        let encoder = JSONEncoder()
        request.httpBody = try encoder.encode(payload)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard httpResponse.statusCode == 200 else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw APIError.httpError(statusCode: httpResponse.statusCode, body: body)
        }

        do {
            return try JSONDecoder().decode(InstallPrepareResponse.self, from: data)
        } catch {
            throw APIError.decodingFailed(error.localizedDescription)
        }
    }

    /// Updates the backend execution record for an install attempt.
    func updateInstallExecution(
        executionId: String,
        status: InstallExecutionStatusUpdate
    ) async throws {
        let endpoint = baseURL.appendingPathComponent("v1/install/executions/\(executionId)/status")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let encoder = JSONEncoder()
        request.httpBody = try encoder.encode(status)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard httpResponse.statusCode == 200 else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw APIError.httpError(statusCode: httpResponse.statusCode, body: body)
        }
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
        let osVer = ProcessInfo.processInfo.operatingSystemVersion
        let osVersion = "\(osVer.majorVersion).\(osVer.minorVersion).\(osVer.patchVersion)"
        let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String

        let inventoryApps = apps.map { app in
            InventoryCheckRequest.InventoryApp(
                appName: app.name,
                bundleId: app.bundleId,
                version: app.version,
                buildNumber: app.buildNumber,
                teamId: app.teamId,
                pathHash: pathHash(app.path),
                architecture: app.architecture,
                sparkleFeedUrl: app.sparkleFeedUrl,
                isMasApp: app.isMasApp ? true : nil,
                electronUpdateUrl: app.electronUpdateUrl
            )
        }

        return InventoryCheckRequest(
            client: .init(
                installId: installId,
                platform: "macos",
                appVersion: appVersion,
                osVersion: osVersion,
                systemArchitecture: Self.systemArchitecture()
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

    /// Detects the real hardware architecture, seeing through Rosetta translation.
    private static func systemArchitecture() -> String {
        var size = 256
        var machine = [CChar](repeating: 0, count: size)
        sysctlbyname("hw.machine", &machine, &size, nil, 0)
        let reported = String(
            decoding: machine.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) },
            as: UTF8.self
        )

        // If reported as x86_64, check if actually running under Rosetta on ARM
        if reported == "x86_64" {
            var translated: Int32 = 0
            var tsize = MemoryLayout<Int32>.size
            if sysctlbyname("sysctl.proc_translated", &translated, &tsize, nil, 0) == 0,
               translated == 1
            {
                return "arm64"
            }
        }
        return reported
    }

    /// Simple hash of the app path for deduplication on the backend.
    private func pathHash(_ path: String) -> String {
        let digest = SHA256.hash(data: Data(path.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}

nonisolated enum APIError: LocalizedError, Sendable {
    case invalidResponse
    case httpError(statusCode: Int, body: String)
    case decodingFailed(String)
    case installNotAvailable

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            "Invalid response from server"
        case .httpError(let statusCode, _):
            "Server returned status \(statusCode)"
        case .decodingFailed(let message):
            "Failed to decode response: \(message)"
        case .installNotAvailable:
            "Install is not available for this app"
        }
    }
}
