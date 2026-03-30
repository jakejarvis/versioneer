import { z } from "zod";

export const feedbackTypeValues = [
  "wrong_match",
  "wrong_version",
  "app_request",
  "general",
] as const;
export const feedbackTypeSchema = z.enum(feedbackTypeValues);
export type FeedbackType = z.infer<typeof feedbackTypeSchema>;

export const feedbackStatusValues = ["new", "triaged", "resolved", "dismissed"] as const;
export const feedbackStatusSchema = z.enum(feedbackStatusValues);
export type FeedbackStatus = z.infer<typeof feedbackStatusSchema>;
