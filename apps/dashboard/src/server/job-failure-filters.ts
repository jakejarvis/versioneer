import { and, eq, ne } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { jobFailures } from "@versioneer/db";

export const sourceAnomalyJobType = "source-anomaly";

export function isOperationalJobFailureType(jobType: string) {
  return jobType !== sourceAnomalyJobType;
}

export function operationalJobFailureCondition() {
  return ne(jobFailures.jobType, sourceAnomalyJobType);
}

export function openOperationalJobFailureCondition() {
  return and(eq(jobFailures.status, "open"), operationalJobFailureCondition());
}

export function appendJobFailureTypeFilter(filters: SQL[], jobType: string | undefined) {
  if (!jobType || jobType === "operational") {
    filters.push(operationalJobFailureCondition());
    return;
  }

  if (jobType !== "all") {
    filters.push(eq(jobFailures.jobType, jobType));
  }
}
