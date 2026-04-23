import Foundation
import Testing

@testable import Versioneer

struct InstallExecutionContractTests {
  @Test func decodesPrepareResponseAndEncodesEventPayload() throws {
    let prepareJson = """
      {
        "execution": {
          "id": "exec_123",
          "status": "prepared"
        }
      }
      """
    let prepare = try JSONDecoder().decode(
      InstallExecutionCreateResponse.self, from: Data(prepareJson.utf8))

    #expect(prepare.execution.id == "exec_123")
    #expect(prepare.execution.status == "prepared")

    let payload = InstallExecutionEventRequest(
      event: .init(
        status: "succeeded",
        installedVersion: "127.0",
        errorMessage: nil
      ),
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

    #expect((json["event"] as? [String: Any])?["status"] as? String == "succeeded")
    #expect(json["install"] == nil)
    #expect(json["target"] == nil)
    #expect(json["expected"] == nil)
    #expect(json["client"] == nil)
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
