import CryptoKit
import DeviceCheck
import Foundation
import Logging
import Security

/// Provides a valid auth token for API requests.
protocol TokenProvider: Sendable {
  func validToken() async throws -> String
}

/// Manages App Attest attestation, token refresh, and Keychain persistence.
actor AppAttestClient: TokenProvider {
  private let baseURL: URL
  private let service = DCAppAttestService.shared

  nonisolated private static let keychainService = "com.jakejarvis.versioneer.attest"
  nonisolated private static let keyIdAccount = "attestKeyId"
  nonisolated private static let tokenAccount = "attestToken"

  private var cachedToken: String?
  private var cachedKeyId: String?

  init(baseURL: URL) {
    self.baseURL = baseURL
    self.cachedKeyId = Self.loadKeychain(account: Self.keyIdAccount)
    self.cachedToken = Self.loadKeychain(account: Self.tokenAccount)
  }

  /// Returns a valid JWT token, performing attestation or refresh as needed.
  func validToken() async throws -> String {
    // Check cached/Keychain token
    if let token = cachedToken, !isExpired(token) {
      return token
    }

    // If we have a keyId, try refreshing
    if let keyId = cachedKeyId {
      do {
        return try await refreshToken(keyId: keyId)
      } catch {
        Logger.attest.warning("Token refresh failed, re-attesting: \(error.localizedDescription)")
        clearState()
      }
    }

    // Full attestation from scratch
    return try await performAttestation()
  }

  /// Clears stored state and re-attests from scratch.
  func forceReAttest() async throws -> String {
    clearState()
    return try await performAttestation()
  }

  // MARK: - Attestation

  private func performAttestation() async throws -> String {
    Logger.attest.info("Starting App Attest attestation")

    guard service.isSupported else {
      Logger.attest.error("App Attest is not supported on this device or build configuration")
      throw AppAttestError.notSupported
    }

    let keyId = try await service.generateKey()

    let challenge = try await fetchChallenge()
    let clientDataHash = Data(SHA256.hash(data: Data(challenge.utf8)))

    let attestation = try await service.attestKey(keyId, clientDataHash: clientDataHash)

    let response = try await postJSON(
      path: "v1/attest",
      body: AttestRequest(
        keyId: keyId,
        attestation: attestation.base64EncodedString(),
        challenge: challenge
      )
    ) as AttestResponse

    cachedKeyId = keyId
    cachedToken = response.token
    Self.saveKeychain(account: Self.keyIdAccount, value: keyId)
    Self.saveKeychain(account: Self.tokenAccount, value: response.token)

    Logger.attest.info("Attestation succeeded, device: \(response.deviceId)")
    return response.token
  }

  // MARK: - Refresh

  private func refreshToken(keyId: String) async throws -> String {
    Logger.attest.info("Refreshing App Attest token")

    let challenge = try await fetchChallenge()
    let clientDataHash = Data(SHA256.hash(data: Data(challenge.utf8)))

    let assertion = try await service.generateAssertion(keyId, clientDataHash: clientDataHash)

    let response = try await postJSON(
      path: "v1/attest/refresh",
      body: AttestRefreshRequest(
        keyId: keyId,
        assertion: assertion.base64EncodedString(),
        challenge: challenge
      )
    ) as AttestResponse

    cachedToken = response.token
    Self.saveKeychain(account: Self.tokenAccount, value: response.token)

    Logger.attest.info("Token refresh succeeded")
    return response.token
  }

  // MARK: - Challenge

  private func fetchChallenge() async throws -> String {
    let url = baseURL.appendingPathComponent("v1/attest/challenge")
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Accept")

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
      throw AppAttestError.challengeFailed
    }

    let decoded = try JSONDecoder().decode(ChallengeResponse.self, from: data)
    return decoded.challenge
  }

  // MARK: - JWT expiry check

  private func isExpired(_ token: String) -> Bool {
    let parts = token.split(separator: ".")
    guard parts.count >= 2,
      let payloadData = Data(base64Encoded: Self.base64urlToBase64(String(parts[1]))),
      let json = try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any],
      let exp = json["exp"] as? TimeInterval
    else {
      return true
    }
    // Treat as expired 60 seconds early
    return Date().timeIntervalSince1970 >= (exp - 60)
  }

  /// Converts a base64url string (used in JWTs) to standard base64 with padding.
  nonisolated private static func base64urlToBase64(_ string: String) -> String {
    var result = string
      .replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    let remainder = result.count % 4
    if remainder > 0 {
      result += String(repeating: "=", count: 4 - remainder)
    }
    return result
  }

  // MARK: - HTTP helpers

  private func postJSON<B: Encodable, R: Decodable>(path: String, body: B) async throws -> R {
    let url = baseURL.appendingPathComponent(path)
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(body)

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let http = response as? HTTPURLResponse else {
      throw AppAttestError.invalidResponse
    }

    guard (200...299).contains(http.statusCode) else {
      let body = String(data: data, encoding: .utf8) ?? ""
      Logger.attest.error("Attest endpoint returned \(http.statusCode): \(body)")
      throw AppAttestError.serverError(statusCode: http.statusCode, body: body)
    }

    return try JSONDecoder().decode(R.self, from: data)
  }

  // MARK: - State management

  private func clearState() {
    cachedKeyId = nil
    cachedToken = nil
    Self.deleteKeychain(account: Self.keyIdAccount)
    Self.deleteKeychain(account: Self.tokenAccount)
  }

  // MARK: - Keychain

  nonisolated private static func loadKeychain(account: String) -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  nonisolated private static func saveKeychain(account: String, value: String) {
    deleteKeychain(account: account)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: account,
      kSecValueData as String: Data(value.utf8),
    ]
    SecItemAdd(query as CFDictionary, nil)
  }

  nonisolated private static func deleteKeychain(account: String) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: account,
    ]
    SecItemDelete(query as CFDictionary)
  }
}

// MARK: - DTOs

private nonisolated struct ChallengeResponse: Codable, Sendable {
  let challenge: String
}

private nonisolated struct AttestRequest: Encodable, Sendable {
  let keyId: String
  let attestation: String
  let challenge: String
}

private nonisolated struct AttestRefreshRequest: Encodable, Sendable {
  let keyId: String
  let assertion: String
  let challenge: String
}

private nonisolated struct AttestResponse: Decodable, Sendable {
  let token: String
  let deviceId: String
}

// MARK: - Errors

private enum AppAttestError: LocalizedError {
  case notSupported
  case challengeFailed
  case invalidResponse
  case serverError(statusCode: Int, body: String)

  var errorDescription: String? {
    switch self {
    case .notSupported:
      "App Attest is not supported on this device or build configuration"
    case .challengeFailed:
      "Failed to fetch attestation challenge"
    case .invalidResponse:
      "Invalid response from attestation server"
    case .serverError(let code, _):
      "Attestation server error (HTTP \(code))"
    }
  }
}
