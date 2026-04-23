import { z } from "zod";

import { paginatedSearchDefaults } from "@/lib/data-table-search";

const pageSizeSchema = z
  .union([z.literal(25), z.literal(50), z.literal(100)])
  .default(paginatedSearchDefaults.pageSize)
  .catch(paginatedSearchDefaults.pageSize);
const pageSchema = z.coerce.number().int().min(1).default(1).catch(1);
const sortDirSchema = z.enum(["asc", "desc"]).optional();
export const jobTypeSchema = z.enum(["poll_sources", "cask_index_sync", "enrich_discovered_apps"]);

export const runJobTypeFilterSchema = z.enum([
  "all",
  "poll_sources",
  "cask_index_sync",
  "enrich_discovered_apps",
]);
export const runTriggerFilterSchema = z.enum(["all", "manual", "scheduled"]);
export const runStatusFilterSchema = z.enum(["all", "running", "completed", "failed"]);
export const failureStatusSchema = z.enum(["open", "retrying", "resolved", "abandoned"]);
export const failureJobTypeSchema = z.enum([
  "all",
  "source-anomaly",
  "source-fetch",
  "source-parse",
  "recompute-latest",
  "poll_sources",
  "cask_index_sync",
  "enrich_discovered_apps",
  "inventory_followup",
]);

export const jobsSearchDefaults = {
  runPage: 1,
  runPageSize: paginatedSearchDefaults.pageSize,
  runJobType: "all" as const,
  runTrigger: "all" as const,
  runStatus: "all" as const,
  failurePage: 1,
  failurePageSize: paginatedSearchDefaults.pageSize,
  failureJobType: "all" as const,
  failureStatus: "open" as const,
  failureId: "",
};

export const jobsFailureSearch = {
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
} as const;

export const jobsRunsSearch = {
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
} as const;

export const jobsSearchSchema = z.object({
  runPage: pageSchema.default(jobsSearchDefaults.runPage).catch(jobsSearchDefaults.runPage),
  runPageSize: pageSizeSchema,
  runSortBy: z.string().optional(),
  runSortDir: sortDirSchema,
  runJobType: runJobTypeFilterSchema
    .default(jobsSearchDefaults.runJobType)
    .catch(jobsSearchDefaults.runJobType),
  runTrigger: runTriggerFilterSchema
    .default(jobsSearchDefaults.runTrigger)
    .catch(jobsSearchDefaults.runTrigger),
  runStatus: runStatusFilterSchema
    .default(jobsSearchDefaults.runStatus)
    .catch(jobsSearchDefaults.runStatus),
  failurePage: pageSchema
    .default(jobsSearchDefaults.failurePage)
    .catch(jobsSearchDefaults.failurePage),
  failurePageSize: pageSizeSchema,
  failureSortBy: z.string().optional(),
  failureSortDir: sortDirSchema,
  failureJobType: failureJobTypeSchema
    .default(jobsSearchDefaults.failureJobType)
    .catch(jobsSearchDefaults.failureJobType),
  failureStatus: failureStatusSchema
    .default(jobsSearchDefaults.failureStatus)
    .catch(jobsSearchDefaults.failureStatus),
  failureId: z.string().default(jobsSearchDefaults.failureId).catch(jobsSearchDefaults.failureId),
  tab: z.enum(["runs", "failures"]).optional(),
  jobType: runJobTypeFilterSchema.optional(),
});

export type JobsSearch = z.infer<typeof jobsSearchSchema>;
