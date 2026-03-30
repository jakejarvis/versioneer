import { z } from "zod";

export const jobFailureStatusValues = ["open", "retrying", "resolved", "abandoned"] as const;
export const jobFailureStatusSchema = z.enum(jobFailureStatusValues);
export type JobFailureStatus = z.infer<typeof jobFailureStatusSchema>;

export const cronJobTypeValues = ["poll_sources", "cask_index_sync"] as const;
export const cronJobTypeSchema = z.enum(cronJobTypeValues);
export type CronJobType = z.infer<typeof cronJobTypeSchema>;

export const cronTriggerValues = ["manual", "scheduled"] as const;
export const cronTriggerSchema = z.enum(cronTriggerValues);
export type CronTrigger = z.infer<typeof cronTriggerSchema>;

export const cronRunStatusValues = ["running", "completed", "failed"] as const;
export const cronRunStatusSchema = z.enum(cronRunStatusValues);
export type CronRunStatus = z.infer<typeof cronRunStatusSchema>;

export const executionRouteValues = [
  "sparkle",
  "local_replace",
  "privileged_replace",
  "privileged_package",
] as const;
export const executionRouteSchema = z.enum(executionRouteValues);
export type ExecutionRoute = z.infer<typeof executionRouteSchema>;

export const installExecutionStatusValues = [
  "prepared",
  "started",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export const installExecutionStatusSchema = z.enum(installExecutionStatusValues);
export type InstallExecutionStatus = z.infer<typeof installExecutionStatusSchema>;
