import Foundation
import Testing

@testable import Versioneer

struct InstallExecutionContractTests {
  @Test func decodesPrepareResponseAndEncodesStatusPayload() throws {
    let prepareJson = """
      {
        "executionId": "exec_123",
        "status": "prepared"
      }
      """
    let prepare = try JSONDecoder().decode(InstallPrepareResponse.self, from: Data(prepareJson.utf8))

    #expect(prepare.executionId == "exec_123")
    #expect(prepare.status == "prepared")

    let payload = InstallExecutionStatusRequest(
      client: .init(
        platform: "macos",
        appVersion: "1.0.0",
        osVersion: "15.4",
        systemArchitecture: "arm64",
        channelPreferences: nil
      ),
      appId: "app_firefox",
      releaseId: "rel_firefox",
      artifactId: "art_firefox",
      installStrategy: "zip_replace",
      executionRoute: "local_replace",
      channel: "stable",
      previousVersion: "126.0",
      installedVersion: "127.0",
      bundleId: "org.mozilla.firefox",
      teamId: "43AQ936H96",
      status: "succeeded",
      errorMessage: nil,
      verification: .init(
        strategy: "zip_replace",
        executionRoute: "local_replace",
        hashVerified: true,
        signatureVerified: true,
        notarizationVerified: true,
        bundleIdMatch: true,
        teamIdMatch: true,
        versionMatch: true,
        observedBundleId: "org.mozilla.firefox",
        observedTeamId: "43AQ936H96",
        observedVersion: "127.0"
      )
    )

    let encoded = try JSONEncoder().encode(payload)
    let json = try #require(
      JSONSerialization.jsonObject(with: encoded) as? [String: Any]
    )

    #expect(json["status"] as? String == "succeeded")
    #expect(json["executionRoute"] as? String == "local_replace")
    #expect(json["installStrategy"] as? String == "zip_replace")
    #expect(json["previousVersion"] as? String == "126.0")
    #expect((json["verification"] as? [String: Any])?["signatureVerified"] as? Bool == true)
  }

  @Test func processRunnerCapturesLargeStdoutAndStderr() async throws {
    let script = """
      i=0
      while [ "$i" -lt 5000 ]; do
        echo "stdout-$i"
        echo "stderr-$i" 1>&2
        i=$((i + 1))
      done
      """

    let result = try await ProcessRunner.runSuccessful(
      "/bin/sh",
      arguments: ["-c", script]
    )

    #expect(result.terminationStatus == 0)
    #expect(result.stdout.contains("stdout-4999"))
    #expect(result.stderr.contains("stderr-4999"))
  }
}
