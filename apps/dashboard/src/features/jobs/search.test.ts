import { describe, expect, it } from "vite-plus/test";

import {
  jobsFailuresSearch,
  jobsFailuresSearchDefaults,
  jobsFailuresSearchSchema,
  jobsRunsSearch,
  jobsRunsSearchDefaults,
  jobsRunsSearchSchema,
} from "./search";

describe("jobs search defaults", () => {
  it("preserves the runs link search object", () => {
    expect(jobsRunsSearch).toEqual({
      page: jobsRunsSearchDefaults.page,
      pageSize: jobsRunsSearchDefaults.pageSize,
      jobType: jobsRunsSearchDefaults.jobType,
      trigger: jobsRunsSearchDefaults.trigger,
      status: jobsRunsSearchDefaults.status,
    });
  });

  it("preserves the failures link search object", () => {
    expect(jobsFailuresSearch).toEqual({
      page: jobsFailuresSearchDefaults.page,
      pageSize: jobsFailuresSearchDefaults.pageSize,
      jobType: jobsFailuresSearchDefaults.jobType,
      status: jobsFailuresSearchDefaults.status,
      failureId: jobsFailuresSearchDefaults.failureId,
    });
  });

  it("uses the current run defaults when search params are omitted or invalid", () => {
    expect(jobsRunsSearchSchema.parse({})).toEqual(jobsRunsSearch);
    expect(
      jobsRunsSearchSchema.parse({
        page: 0,
        pageSize: 999,
        jobType: "nope",
        trigger: "sometimes",
        status: "broken",
      }),
    ).toEqual(jobsRunsSearch);
  });

  it("uses the current failure defaults when search params are omitted or invalid", () => {
    expect(jobsFailuresSearchSchema.parse({})).toEqual(jobsFailuresSearch);
    expect(
      jobsFailuresSearchSchema.parse({
        page: -4,
        pageSize: 999,
        jobType: "bad",
        status: "closed",
        failureId: 7,
      }),
    ).toEqual(jobsFailuresSearch);
  });
});
