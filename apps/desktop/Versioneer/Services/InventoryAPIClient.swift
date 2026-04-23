import AppKit
import Foundation
import Logging
import zlib

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
    let releaseNotesMarkdown: String?
    let releaseNotesHtml: String?
    let releaseNotesUrl: String?
  }

  /// Fetches release notes for a specific release.
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

  /// Submits inventory and returns the decoded response.
  func checkInventory(
    apps: [InstalledApp],
    scanDurationMs: Int?,
    channels: InventoryCheckRequest.Channels?
  ) async throws
    -> InventoryCheckResponse
  {
    let endpoint = baseURL.appendingPathComponent("v1/inventory/check")
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    let payload = buildRequest(
      from: apps, scanDurationMs: scanDurationMs, channels: channels)

    let encoder = JSONEncoder()
    let jsonData = try encoder.encode(payload)

    if let compressed = Self.gzipCompress(jsonData) {
      request.httpBody = compressed
      request.setValue("gzip", forHTTPHeaderField: "Content-Encoding")
      Logger.api.info(
        "Submitting inventory with \(apps.count) apps (\(jsonData.count) bytes → \(compressed.count) bytes gzipped)"
      )
    } else {
      request.httpBody = jsonData
      Logger.api.info("Submitting inventory with \(apps.count) apps (\(jsonData.count) bytes)")
    }

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
      let response = try decoder.decode(InventoryCheckResponse.self, from: data)
      try Self.validateInventoryResponseCompleteness(response, submittedAppCount: apps.count)
      return response
    } catch let error as APIError {
      throw error
    } catch {
      Logger.api.error("Failed to decode response: \(error.localizedDescription)")
      throw APIError.decodingFailed(error.localizedDescription)
    }
  }

  static func validateInventoryResponseCompleteness(
    _ response: InventoryCheckResponse,
    submittedAppCount: Int
  ) throws {
    let handledCount = response.results.count + response.issues.invalidApps.count
    guard handledCount == submittedAppCount else {
      throw APIError.incompleteInventoryResponse(
        expected: submittedAppCount, received: handledCount)
    }
  }

  private func buildRequest(
    from apps: [InstalledApp],
    scanDurationMs: Int?,
    channels: InventoryCheckRequest.Channels?
  ) -> InventoryCheckRequest {
    let inventoryApps = apps.map { app in
      InventoryCheckRequest.InventoryApp(
        appName: app.name,
        bundleId: app.bundleId,
        version: app.version,
        buildNumber: app.buildNumber,
        teamId: app.teamId,
        architecture: app.architecture,
        sparkleFeedUrl: app.sparkleFeedUrl,
        sparklePublicKey: app.sparklePublicKey,
        isSparkleApp: app.isSparkleApp ? true : nil,
        isMasApp: app.isMasApp ? true : nil,
        masAppId: app.masAppId,
        isElectronApp: app.isElectronApp ? true : nil,
        electronUpdateProvider: app.electronUpdateProvider,
        electronUpdateUrl: app.electronUpdateUrl,
        codeSigningAuthority: app.codeSigningAuthority,
        appCategory: app.appCategory,
        minMacOSVersion: app.minMacOSVersion,
        iconBase64: Self.extractIconBase64(for: app),
        isHomebrewInstalled: app.isHomebrewInstalled ? true : nil,
        homebrewCaskToken: app.homebrewCaskToken
      )
    }

    return InventoryCheckRequest(
      client: buildClientInfo(channels: channels),
      apps: inventoryApps,
      scanDurationMs: scanDurationMs
    )
  }

  func prepareInstallExecution(
    plan: InstallPlan,
    installedApp: InstalledApp,
    executionRoute: InstallCoordinator.ExecutionRoute
  ) async throws -> InstallExecutionCreateResponse {
    guard let appId = plan.appId,
      let releaseId = plan.releaseId
    else {
      throw APIError.invalidRequest("Catalog-backed install plan required")
    }

    let endpoint = baseURL.appendingPathComponent("v1/install/executions")
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    let payload = InstallExecutionCreateRequest(
      client: buildClientInfo(channels: nil),
      target: .init(
        appId: appId,
        releaseId: releaseId,
        artifactId: plan.artifact?.id,
        targetArchitecture: plan.targetArchitecture,
        channel: plan.channel
      ),
      install: .init(
        strategy: plan.strategy.rawValue,
        executionRoute: executionRoute.rawValue
      ),
      expected: .init(
        previousVersion: installedApp.version,
        bundleId: installedApp.bundleId,
        teamId: installedApp.teamId
      )
    )
    request.httpBody = try JSONEncoder().encode(payload)

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse else {
      throw APIError.invalidResponse
    }

    guard httpResponse.statusCode == 200 else {
      let body = String(data: data, encoding: .utf8) ?? ""
      throw APIError.httpError(statusCode: httpResponse.statusCode, body: body)
    }

    do {
      return try JSONDecoder().decode(InstallExecutionCreateResponse.self, from: data)
    } catch {
      throw APIError.decodingFailed(error.localizedDescription)
    }
  }

  func reportInstallExecutionStatus(
    executionId: String,
    status: String,
    installedVersion: String?,
    errorMessage: String?,
    verification: InstallVerificationSummary?
  ) async throws -> InstallExecutionEventResponse {
    let endpoint = baseURL.appendingPathComponent("v1/install/executions/\(executionId)/events")
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    let payload = InstallExecutionEventRequest(
      event: .init(
        status: status,
        installedVersion: installedVersion,
        errorMessage: errorMessage
      ),
      verification: verification
    )
    request.httpBody = try JSONEncoder().encode(payload)

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse else {
      throw APIError.invalidResponse
    }

    guard httpResponse.statusCode == 200 else {
      let body = String(data: data, encoding: .utf8) ?? ""
      throw APIError.httpError(statusCode: httpResponse.statusCode, body: body)
    }

    do {
      return try JSONDecoder().decode(InstallExecutionEventResponse.self, from: data)
    } catch {
      throw APIError.decodingFailed(error.localizedDescription)
    }
  }

  private func buildClientInfo(
    channels: InventoryCheckRequest.Channels?
  ) -> InventoryCheckRequest.ClientInfo {
    let osVer = ProcessInfo.processInfo.operatingSystemVersion
    let osVersion = "\(osVer.majorVersion).\(osVer.minorVersion).\(osVer.patchVersion)"
    let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String

    return .init(
      platform: "macos",
      appVersion: appVersion,
      osVersion: osVersion,
      systemArchitecture: Self.systemArchitecture(),
      channels: channels
    )
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

  /// Compresses data using gzip (RFC 1952) via zlib's deflateInit2.
  private static func gzipCompress(_ data: Data) -> Data? {
    var stream = z_stream()
    // windowBits = 15 + 16 tells zlib to produce gzip format (with header/trailer)
    guard
      deflateInit2_(
        &stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, 15 + 16, 8,
        Z_DEFAULT_STRATEGY, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK
    else { return nil }

    defer { deflateEnd(&stream) }

    let chunkSize = 65536
    var output = Data()

    data.withUnsafeBytes { inputPtr in
      stream.next_in = UnsafeMutablePointer(
        mutating: inputPtr.baseAddress!.assumingMemoryBound(to: UInt8.self))
      stream.avail_in = uInt(data.count)

      var chunk = Data(count: chunkSize)
      repeat {
        chunk.withUnsafeMutableBytes { chunkPtr in
          stream.next_out = chunkPtr.baseAddress!.assumingMemoryBound(to: UInt8.self)
          stream.avail_out = uInt(chunkSize)
          deflate(&stream, Z_FINISH)
        }
        let produced = chunkSize - Int(stream.avail_out)
        output.append(chunk.prefix(produced))
      } while stream.avail_out == 0
    }

    return output
  }

  /// Extracts the app's icon as a 128x128 PNG encoded in base64.
  /// Returns nil if the app path doesn't exist or icon extraction fails.
  private static func extractIconBase64(for app: InstalledApp) -> String? {
    guard FileManager.default.fileExists(atPath: app.path) else { return nil }

    let icon = NSWorkspace.shared.icon(forFile: app.path)
    let targetSize = NSSize(width: 128, height: 128)

    let resized = NSImage(size: targetSize)
    resized.lockFocus()
    icon.draw(
      in: NSRect(origin: .zero, size: targetSize),
      from: NSRect(origin: .zero, size: icon.size),
      operation: .copy,
      fraction: 1.0
    )
    resized.unlockFocus()

    guard let tiff = resized.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:])
    else { return nil }

    return png.base64EncodedString()
  }
}

nonisolated enum APIError: LocalizedError, Sendable {
  case invalidResponse
  case invalidRequest(String)
  case httpError(statusCode: Int, body: String)
  case decodingFailed(String)
  case incompleteInventoryResponse(expected: Int, received: Int)

  var errorDescription: String? {
    switch self {
    case .invalidResponse:
      "Invalid response from server"
    case .invalidRequest(let message):
      message
    case .httpError(let statusCode, _):
      "Server returned status \(statusCode)"
    case .decodingFailed(let message):
      "Failed to decode response: \(message)"
    case .incompleteInventoryResponse(let expected, let received):
      "Inventory response handled \(received) of \(expected) submitted apps"
    }
  }
}
