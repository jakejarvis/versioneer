import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { appendJobFailureTypeFilter, isOperationalJobFailureType } from "./job-failure-filters";

describe("job failure filters", () => {
  it("treats source anomalies as non-operational failures", () => {
    expect(isOperationalJobFailureType("source-fetch")).toBe(true);
    expect(isOperationalJobFailureType("inventory_ingestion")).toBe(true);
    expect(isOperationalJobFailureType("source-anomaly")).toBe(false);
  });

  it("keeps all/source-anomaly filters explicit while defaulting to operational", () => {
    const operationalFilters: SQL[] = [];
    appendJobFailureTypeFilter(operationalFilters, "operational");
    expect(operationalFilters).toHaveLength(1);

    const defaultFilters: SQL[] = [];
    appendJobFailureTypeFilter(defaultFilters, undefined);
    expect(defaultFilters).toHaveLength(1);

    const allFilters: SQL[] = [];
    appendJobFailureTypeFilter(allFilters, "all");
    expect(allFilters).toHaveLength(0);

    const anomalyFilters: SQL[] = [];
    appendJobFailureTypeFilter(anomalyFilters, "source-anomaly");
    expect(anomalyFilters).toHaveLength(1);
  });
});
