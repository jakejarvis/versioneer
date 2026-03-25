import type { ArtifactSelectionExplanation, DecisionExplanation } from "@versioneer/api-contracts";

interface ReleaseCandidate {
  id: string;
  versionNormalized: string;
  versionRaw: string;
  sourceConfidence: number | null;
}

interface OverrideRecord {
  id: string;
}

interface ArtifactRecord {
  id: string;
  artifactType: string;
  signatureStatus: string | null;
  notarizationStatus: string | null;
  isPrimary: boolean;
}

export function generatePublicationExplanation(
  winning: ReleaseCandidate,
  candidates: ReleaseCandidate[],
  override: OverrideRecord | null | undefined,
  _artifact: ArtifactRecord | null | undefined,
): DecisionExplanation {
  const reason = override ? "override" : "highest_version";

  const alternatesRejected = candidates
    .filter((c) => c.id !== winning.id)
    .slice(0, 10)
    .map((c) => ({
      releaseId: c.id,
      version: c.versionRaw,
      reason: override ? "override_selected_different_release" : "lower_version",
    }));

  return {
    selectedReleaseId: winning.id,
    selectedVersion: winning.versionRaw,
    reason,
    overrideId: override?.id ?? null,
    candidateCount: candidates.length,
    alternatesRejected,
    sourceConfidence: winning.sourceConfidence,
  };
}

export function generateArtifactSelectionExplanation(
  primary: ArtifactRecord | null | undefined,
  allArtifacts: ArtifactRecord[],
): ArtifactSelectionExplanation {
  if (!primary) {
    return {
      primaryArtifactId: null,
      artifactType: null,
      reason: "no_artifacts",
      signatureStatus: null,
      notarizationStatus: null,
      candidateCount: allArtifacts.length,
    };
  }

  return {
    primaryArtifactId: primary.id,
    artifactType: primary.artifactType,
    reason: "marked_as_primary",
    signatureStatus: primary.signatureStatus,
    notarizationStatus: primary.notarizationStatus,
    candidateCount: allArtifacts.length,
  };
}
