import AppKit
import Foundation
import Logging
import zlib

/// Submits app inventory to the backend and decodes update decisions.
nonisolated struct InventoryAPIClient: Sendable {
  let baseURL: URL
  let session: URLSession

  init(baseURL: URL, session: URLSession = .shared) {
    self.baseURL = baseURL
    self.session = session
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

  struct InventoryIconUploadSummary: Sendable, Equatable {
    var requested: Int
    var attempted: Int
    var accepted: Int
    var skipped: Int
    var invalid: Int
    var failed: Int

    static let empty = InventoryIconUploadSummary(
      requested: 0,
      attempted: 0,
      accepted: 0,
      skipped: 0,
      invalid: 0,
      failed: 0
    )

    mutating func merge(_ other: InventoryIconUploadSummary) {
      requested += other.requested
      attempted += other.attempted
      accepted += other.accepted
      skipped += other.skipped
      invalid += other.invalid
      failed += other.failed
    }
  }

  private struct InventoryIconUploadRequestPayload: Codable, Sendable {
    let items: [Item]

    struct Item: Codable, Sendable, Equatable {
      let uploadId: String
      let iconBase64: String
    }
  }

  private struct InventoryIconUploadServerResponse: Codable, Sendable {
    let submissionId: String
    let results: [Result]

    struct Result: Codable, Sendable {
      let uploadId: String
      let status: Status
      let reason: String?
      let retryable: Bool?

      enum Status: String, Codable, Sendable {
        case accepted
        case skipped
        case invalid
        case failed
      }
    }
  }

  /// Fetches release notes for a specific release.
  func fetchReleaseNotes(releaseId: String) async throws -> ReleaseNotesResponse {
    let endpoint = baseURL.appendingPathComponent("v1/releases/\(releaseId)/notes")
    var request = URLRequest(url: endpoint)
    request.httpMethod = "GET"
    request.setValue("application/json", forHTTPHeaderField: "Accept")

    let (data, response) = try await session.data(for: request)

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

    let (data, response) = try await session.data(for: request)

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
        iconBase64: nil,
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

  @discardableResult
  func uploadRequestedIcons(
    _ iconUpload: InventoryCheckResponse.IconUpload?,
    from apps: [InstalledApp],
    iconExtractor: @escaping @Sendable (InstalledApp) -> String? = {
      Self.extractIconBase64(for: $0)
    }
  ) async -> InventoryIconUploadSummary {
    guard let iconUpload, !iconUpload.items.isEmpty else {
      return .empty
    }

    let appsByLookupKey = Self.appsByLookupKey(apps)
    var uploadItems: [InventoryIconUploadRequestPayload.Item] = []
    var summary = InventoryIconUploadSummary(
      requested: iconUpload.items.count,
      attempted: 0,
      accepted: 0,
      skipped: 0,
      invalid: 0,
      failed: 0
    )

    for item in iconUpload.items {
      guard let app = appsByLookupKey[item.lookupKey] else {
        summary.skipped += 1
        continue
      }
      guard let iconBase64 = iconExtractor(app) else {
        summary.skipped += 1
        continue
      }
      uploadItems.append(.init(uploadId: item.uploadID, iconBase64: iconBase64))
    }

    summary.attempted = uploadItems.count
    for startIndex in stride(from: 0, to: uploadItems.count, by: Self.iconUploadBatchSize) {
      let endIndex = Swift.min(startIndex + Self.iconUploadBatchSize, uploadItems.count)
      let batch = Array(uploadItems[startIndex..<endIndex])
      let batchSummary = await uploadIconBatchWithRetries(batch, uploadPath: iconUpload.uploadPath)
      summary.accepted += batchSummary.accepted
      summary.skipped += batchSummary.skipped
      summary.invalid += batchSummary.invalid
      summary.failed += batchSummary.failed
    }

    Logger.api.info(
      "Inventory icon upload complete: requested=\(summary.requested) attempted=\(summary.attempted) accepted=\(summary.accepted) skipped=\(summary.skipped) invalid=\(summary.invalid) failed=\(summary.failed)"
    )
    return summary
  }

  private func uploadIconBatchWithRetries(
    _ batch: [InventoryIconUploadRequestPayload.Item],
    uploadPath: String
  ) async -> InventoryIconUploadSummary {
    var pending = batch
    var summary = InventoryIconUploadSummary(
      requested: batch.count,
      attempted: batch.count,
      accepted: 0,
      skipped: 0,
      invalid: 0,
      failed: 0
    )

    for attempt in 1...Self.iconUploadMaxAttempts {
      do {
        let response = try await postIconUploadBatch(pending, uploadPath: uploadPath)
        let itemById = Dictionary(uniqueKeysWithValues: pending.map { ($0.uploadId, $0) })
        var retryableItems: [InventoryIconUploadRequestPayload.Item] = []
        let resultById = Dictionary(
          uniqueKeysWithValues: response.results.map { ($0.uploadId, $0) })

        for item in pending {
          guard let result = resultById[item.uploadId] else {
            if attempt < Self.iconUploadMaxAttempts {
              retryableItems.append(item)
            } else {
              summary.failed += 1
            }
            continue
          }

          switch result.status {
          case .accepted:
            summary.accepted += 1
          case .skipped:
            summary.skipped += 1
          case .invalid:
            summary.invalid += 1
          case .failed:
            if result.retryable == true,
              attempt < Self.iconUploadMaxAttempts,
              let retryItem = itemById[result.uploadId]
            {
              retryableItems.append(retryItem)
            } else {
              summary.failed += 1
            }
          }
        }

        if retryableItems.isEmpty {
          return summary
        }
        pending = retryableItems
      } catch {
        if attempt == Self.iconUploadMaxAttempts {
          summary.failed += pending.count
          Logger.api.warning("Inventory icon upload failed: \(error.localizedDescription)")
          return summary
        }
      }

      try? await Task.sleep(for: .milliseconds(250 * attempt))
    }

    return summary
  }

  private func postIconUploadBatch(
    _ batch: [InventoryIconUploadRequestPayload.Item],
    uploadPath: String
  ) async throws -> InventoryIconUploadServerResponse {
    let endpoint = try Self.iconUploadURL(baseURL: baseURL, uploadPath: uploadPath)
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    let jsonData = try JSONEncoder().encode(InventoryIconUploadRequestPayload(items: batch))
    if let compressed = Self.gzipCompress(jsonData) {
      request.httpBody = compressed
      request.setValue("gzip", forHTTPHeaderField: "Content-Encoding")
    } else {
      request.httpBody = jsonData
    }

    let (data, response) = try await session.data(for: request)
    guard let httpResponse = response as? HTTPURLResponse else {
      throw APIError.invalidResponse
    }
    guard httpResponse.statusCode == 200 else {
      let body = String(data: data, encoding: .utf8) ?? ""
      throw APIError.httpError(statusCode: httpResponse.statusCode, body: body)
    }
    do {
      return try JSONDecoder().decode(InventoryIconUploadServerResponse.self, from: data)
    } catch {
      throw APIError.decodingFailed(error.localizedDescription)
    }
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

    let (data, response) = try await session.data(for: request)

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
        errorMessage: InstallExecutionEventRequest.sanitizedErrorMessage(errorMessage)
      ),
      verification: verification
    )
    request.httpBody = try JSONEncoder().encode(payload)

    let (data, response) = try await session.data(for: request)

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

  private static let iconUploadBatchSize = 10
  private static let iconUploadMaxAttempts = 3

  static func lookupKey(appName: String, bundleId: String?) -> String {
    if let bundleId, !bundleId.isEmpty {
      return "bid:\(bundleId.lowercased())"
    }
    let normalizedName =
      appName
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .lowercased()
    let suffix = ".app"
    if normalizedName.hasSuffix(suffix) {
      return "name:\(String(normalizedName.dropLast(suffix.count)))"
    }
    return "name:\(normalizedName)"
  }

  static func appsByLookupKey(_ apps: [InstalledApp]) -> [String: InstalledApp] {
    var result: [String: InstalledApp] = [:]
    for app in apps {
      let key = lookupKey(appName: app.name, bundleId: app.bundleId)
      if result[key] == nil {
        result[key] = app
      }
    }
    return result
  }

  private static func iconUploadURL(baseURL: URL, uploadPath: String) throws -> URL {
    if let absolute = URL(string: uploadPath), absolute.scheme != nil {
      guard absolute.scheme == baseURL.scheme,
        absolute.host == baseURL.host,
        absolute.port == baseURL.port
      else {
        throw APIError.invalidRequest("Icon upload path must stay on the inventory API origin")
      }
      return absolute
    }
    guard let url = URL(string: uploadPath, relativeTo: baseURL)?.absoluteURL else {
      throw APIError.invalidRequest("Invalid icon upload path")
    }
    return url
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
  static func extractIconBase64(for app: InstalledApp) -> String? {
    let appURL = URL(fileURLWithPath: app.path)
    guard FileManager.default.fileExists(atPath: appURL.path) else { return nil }

    let icon =
      bundleIconImage(forAppAt: appURL)
      ?? NSWorkspace.shared.icon(forFile: appURL.path)

    guard let png = pngData(from: icon, targetSize: NSSize(width: 128, height: 128)) else {
      return nil
    }

    return png.base64EncodedString()
  }

  private static func bundleIconImage(forAppAt appURL: URL) -> NSImage? {
    guard let bundle = Bundle(url: appURL),
      let resourceURL = bundle.resourceURL
    else { return nil }

    let info = bundle.infoDictionary ?? [:]
    let iconNames = [
      info["CFBundleIconFile"] as? String,
      info["CFBundleIconName"] as? String,
    ].compactMap { $0 }

    for iconName in iconNames {
      for iconURL in iconResourceURLs(named: iconName, resourceURL: resourceURL) {
        if let image = NSImage(contentsOf: iconURL) {
          return image
        }
      }
    }

    return nil
  }

  static func iconResourceURLs(named iconName: String, resourceURL: URL) -> [URL] {
    let trimmed = iconName.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return [] }

    let iconURL = resourceURL.appendingPathComponent(trimmed)
    if iconURL.pathExtension.isEmpty {
      return [
        iconURL.appendingPathExtension("icns"),
        iconURL,
      ]
    }

    return [iconURL]
  }

  private static func pngData(from icon: NSImage, targetSize: NSSize) -> Data? {
    guard targetSize.width > 0, targetSize.height > 0,
      icon.size.width > 0,
      icon.size.height > 0
    else { return nil }

    let bitmap = NSBitmapImageRep(
      bitmapDataPlanes: nil,
      pixelsWide: Int(targetSize.width),
      pixelsHigh: Int(targetSize.height),
      bitsPerSample: 8,
      samplesPerPixel: 4,
      hasAlpha: true,
      isPlanar: false,
      colorSpaceName: .deviceRGB,
      bytesPerRow: 0,
      bitsPerPixel: 0
    )
    guard let bitmap else { return nil }
    bitmap.size = targetSize

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    icon.draw(
      in: NSRect(origin: .zero, size: targetSize),
      from: NSRect(origin: .zero, size: icon.size),
      operation: .copy,
      fraction: 1.0
    )
    NSGraphicsContext.restoreGraphicsState()

    return bitmap.representation(using: .png, properties: [:])
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
