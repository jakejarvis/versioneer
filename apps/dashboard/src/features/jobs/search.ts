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
  "operational",
  "all",
  "source-anomaly",
  "source-fetch",
  "source-parse",
  "recompute-latest",
  "poll_sources",
  "cask_index_sync",
  "enrich_discovered_apps",
  "inventory_ingestion",
]);

export const jobsRunsSearchDefaults = {
  page: 1,
  pageSize: paginatedSearchDefaults.pageSize,
  sortBy: undefined as string | undefined,
  sortDir: undefined as "asc" | "desc" | undefined,
  jobType: "all" as const,
  trigger: "all" as const,
  status: "all" as const,
};

export const jobsRunsSearch = {
  page: jobsRunsSearchDefaults.page,
  pageSize: jobsRunsSearchDefaults.pageSize,
  jobType: jobsRunsSearchDefaults.jobType,
  trigger: jobsRunsSearchDefaults.trigger,
  status: jobsRunsSearchDefaults.status,
} as const;

export const jobsRunsSearchSchema = z.object({
  page: pageSchema.default(jobsRunsSearchDefaults.page).catch(jobsRunsSearchDefaults.page),
  pageSize: pageSizeSchema,
  sortBy: z.string().optional(),
  sortDir: sortDirSchema,
  jobType: runJobTypeFilterSchema
    .default(jobsRunsSearchDefaults.jobType)
    .catch(jobsRunsSearchDefaults.jobType),
  trigger: runTriggerFilterSchema
    .default(jobsRunsSearchDefaults.trigger)
    .catch(jobsRunsSearchDefaults.trigger),
  status: runStatusFilterSchema
    .default(jobsRunsSearchDefaults.status)
    .catch(jobsRunsSearchDefaults.status),
});

export type JobsRunsSearch = z.infer<typeof jobsRunsSearchSchema>;

export const jobsFailuresSearchDefaults = {
  page: 1,
  pageSize: paginatedSearchDefaults.pageSize,
  sortBy: undefined as string | undefined,
  sortDir: undefined as "asc" | "desc" | undefined,
  jobType: "operational" as const,
  status: "open" as const,
  failureId: "",
};

export const jobsFailuresSearch = {
  page: jobsFailuresSearchDefaults.page,
  pageSize: jobsFailuresSearchDefaults.pageSize,
  jobType: jobsFailuresSearchDefaults.jobType,
  status: jobsFailuresSearchDefaults.status,
  failureId: jobsFailuresSearchDefaults.failureId,
} as const;

export const jobsFailuresSearchSchema = z.object({
  page: pageSchema.default(jobsFailuresSearchDefaults.page).catch(jobsFailuresSearchDefaults.page),
  pageSize: pageSizeSchema,
  sortBy: z.string().optional(),
  sortDir: sortDirSchema,
  jobType: failureJobTypeSchema
    .default(jobsFailuresSearchDefaults.jobType)
    .catch(jobsFailuresSearchDefaults.jobType),
  status: failureStatusSchema
    .default(jobsFailuresSearchDefaults.status)
    .catch(jobsFailuresSearchDefaults.status),
  failureId: z
    .string()
    .default(jobsFailuresSearchDefaults.failureId)
    .catch(jobsFailuresSearchDefaults.failureId),
});

export type JobsFailuresSearch = z.infer<typeof jobsFailuresSearchSchema>;
