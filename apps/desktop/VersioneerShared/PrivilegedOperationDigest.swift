import CryptoKit
import Foundation

nonisolated enum PrivilegedOperationDigestError: LocalizedError {
  case sourceMissing(String)
  case unsupportedSourceEntry(String)

  var errorDescription: String? {
    switch self {
    case .sourceMissing(let path):
      "Expected an existing privileged install source at \(path)."
    case .unsupportedSourceEntry(let path):
      "Privileged install source contains an unsupported file type at \(path)."
    }
  }
}

nonisolated enum PrivilegedOperationDigest {
  static func sha256Hex(for data: Data) -> String {
    hexString(for: SHA256.hash(data: data))
  }

  static func sha256Hex(forFileAt url: URL) throws -> String {
    var hasher = SHA256()
    try updateFileBytes(url, into: &hasher)
    return hexString(for: hasher.finalize())
  }

  static func sourceSHA256(at url: URL) throws -> String {
    let standardizedURL = url.standardizedFileURL
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: standardizedURL.path, isDirectory: &isDirectory)
    else {
      throw PrivilegedOperationDigestError.sourceMissing(standardizedURL.path)
    }

    if isDirectory.boolValue {
      return try directorySHA256(at: standardizedURL)
    }

    return try sha256Hex(forFileAt: standardizedURL)
  }

  private static func directorySHA256(at rootURL: URL) throws -> String {
    var hasher = SHA256()
    updateField("versioneer-privileged-source-v1", into: &hasher)
    try updateMetadata(for: rootURL, relativePath: ".", into: &hasher)

    let entries = try collectEntries(in: rootURL).sorted {
      relativePath(from: rootURL, to: $0) < relativePath(from: rootURL, to: $1)
    }

    for entryURL in entries {
      try updateMetadata(
        for: entryURL,
        relativePath: relativePath(from: rootURL, to: entryURL),
        into: &hasher
      )
    }

    return hexString(for: hasher.finalize())
  }

  private static func collectEntries(in directoryURL: URL) throws -> [URL] {
    let children = try FileManager.default.contentsOfDirectory(
      at: directoryURL,
      includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey],
      options: []
    )

    var entries: [URL] = []
    for child in children {
      let childURL = child.standardizedFileURL
      entries.append(childURL)

      let values = try childURL.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
      if values.isDirectory == true, values.isSymbolicLink != true {
        entries.append(contentsOf: try collectEntries(in: childURL))
      }
    }
    return entries
  }

  private static func updateMetadata(
    for url: URL,
    relativePath: String,
    into hasher: inout SHA256
  ) throws {
    let values = try url.resourceValues(forKeys: [
      .isDirectoryKey,
      .isRegularFileKey,
      .isSymbolicLinkKey,
    ])
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    let mode = ((attributes[.posixPermissions] as? NSNumber)?.uint16Value ?? 0) & 0o7777

    if values.isSymbolicLink == true {
      updateField("symlink", into: &hasher)
      updateField(relativePath, into: &hasher)
      updateField(String(mode, radix: 8), into: &hasher)
      updateField(
        try FileManager.default.destinationOfSymbolicLink(atPath: url.path),
        into: &hasher
      )
      return
    }

    if values.isDirectory == true {
      updateField("directory", into: &hasher)
      updateField(relativePath, into: &hasher)
      updateField(String(mode, radix: 8), into: &hasher)
      return
    }

    guard values.isRegularFile == true else {
      throw PrivilegedOperationDigestError.unsupportedSourceEntry(url.path)
    }

    updateField("file", into: &hasher)
    updateField(relativePath, into: &hasher)
    updateField(String(mode, radix: 8), into: &hasher)
    updateField(String((attributes[.size] as? NSNumber)?.uint64Value ?? 0), into: &hasher)
    try updateFileBytes(url, into: &hasher)
  }

  private static func updateFileBytes(_ url: URL, into hasher: inout SHA256) throws {
    let fileHandle = try FileHandle(forReadingFrom: url)
    defer { try? fileHandle.close() }

    while true {
      let data = try fileHandle.read(upToCount: 1_048_576) ?? Data()
      if data.isEmpty { break }
      hasher.update(data: data)
    }
  }

  private static func updateField(_ field: String, into hasher: inout SHA256) {
    var length = UInt64(field.utf8.count).bigEndian
    withUnsafeBytes(of: &length) { bytes in
      hasher.update(data: Data(bytes))
    }
    hasher.update(data: Data(field.utf8))
  }

  private static func relativePath(from root: URL, to child: URL) -> String {
    let rootPath = root.standardizedFileURL.path
    let childPath = child.standardizedFileURL.path
    guard childPath.hasPrefix(rootPath + "/") else {
      return child.lastPathComponent
    }
    return String(childPath.dropFirst(rootPath.count + 1))
  }

  private static func hexString<D: Sequence>(for digest: D) -> String where D.Element == UInt8 {
    digest.map { String(format: "%02x", $0) }.joined()
  }
}
