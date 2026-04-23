import { describe, expect, it } from "vite-plus/test";

import { jobsFailureSearch, jobsSearchDefaults, jobsSearchSchema } from "./search";

describe("jobs search defaults", () => {
  it("preserves the existing failure-link search object", () => {
    expect(jobsFailureSearch).toEqual({
      runPage: jobsSearchDefaults.runPage,
      runPageSize: jobsSearchDefaults.runPageSize,
      runJobType: jobsSearchDefaults.runJobType,
      runTrigger: jobsSearchDefaults.runTrigger,
      runStatus: jobsSearchDefaults.runStatus,
      failurePage: jobsSearchDefaults.failurePage,
      failurePageSize: jobsSearchDefaults.failurePageSize,
      failureJobType: jobsSearchDefaults.failureJobType,
      failureStatus: jobsSearchDefaults.failureStatus,
      failureId: jobsSearchDefaults.failureId,
    });
  });

  it("uses the current defaults when search params are omitted or invalid", () => {
    expect(jobsSearchSchema.parse({})).toMatchObject(jobsSearchDefaults);
    expect(
      jobsSearchSchema.parse({
        runPage: 0,
        runPageSize: 999,
        runJobType: "nope",
        runTrigger: "sometimes",
        runStatus: "broken",
        failurePage: -4,
        failurePageSize: 999,
        failureJobType: "bad",
        failureStatus: "closed",
        failureId: 7,
      }),
    ).toMatchObject(jobsSearchDefaults);
  });
});
