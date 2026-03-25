import { describe, it, expect } from "vitest";

import { generatePublicationExplanation, generateArtifactSelectionExplanation } from "../explain";

describe("generatePublicationExplanation", () => {
  const candidates = [
    { id: "rel_1", versionNormalized: "2.0.0", versionRaw: "2.0.0", sourceConfidence: 90 },
    { id: "rel_2", versionNormalized: "1.9.0", versionRaw: "1.9.0", sourceConfidence: 85 },
    { id: "rel_3", versionNormalized: "1.8.0", versionRaw: "1.8.0", sourceConfidence: 80 },
  ];

  it("explains pipeline decision with highest_version reason", () => {
    const explanation = generatePublicationExplanation(candidates[0]!, candidates, null, null);

    expect(explanation.selectedReleaseId).toBe("rel_1");
    expect(explanation.selectedVersion).toBe("2.0.0");
    expect(explanation.reason).toBe("highest_version");
    expect(explanation.overrideId).toBeNull();
    expect(explanation.candidateCount).toBe(3);
    expect(explanation.alternatesRejected).toHaveLength(2);
    expect(explanation.alternatesRejected[0]!.reason).toBe("lower_version");
    expect(explanation.sourceConfidence).toBe(90);
  });

  it("explains override decision", () => {
    const override = { id: "ovr_1" };
    const explanation = generatePublicationExplanation(candidates[1]!, candidates, override, null);

    expect(explanation.selectedReleaseId).toBe("rel_2");
    expect(explanation.reason).toBe("override");
    expect(explanation.overrideId).toBe("ovr_1");
    expect(explanation.alternatesRejected[0]!.reason).toBe("override_selected_different_release");
  });
});

describe("generateArtifactSelectionExplanation", () => {
  it("explains primary artifact selection", () => {
    const primary = {
      id: "art_1",
      artifactType: "dmg",
      signatureStatus: "valid",
      notarizationStatus: "notarized",
      isPrimary: true,
    };
    const all = [
      primary,
      {
        id: "art_2",
        artifactType: "zip",
        signatureStatus: "unknown",
        notarizationStatus: "unknown",
        isPrimary: false,
      },
    ];

    const explanation = generateArtifactSelectionExplanation(primary, all);

    expect(explanation.primaryArtifactId).toBe("art_1");
    expect(explanation.artifactType).toBe("dmg");
    expect(explanation.reason).toBe("marked_as_primary");
    expect(explanation.signatureStatus).toBe("valid");
    expect(explanation.candidateCount).toBe(2);
  });

  it("explains no artifacts", () => {
    const explanation = generateArtifactSelectionExplanation(null, []);

    expect(explanation.primaryArtifactId).toBeNull();
    expect(explanation.reason).toBe("no_artifacts");
    expect(explanation.candidateCount).toBe(0);
  });
});
