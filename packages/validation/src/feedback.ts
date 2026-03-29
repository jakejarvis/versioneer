import { z } from "zod";

export const clientFeedbackSubmitSchema = z.object({
  feedbackType: z.enum(["wrong_match", "wrong_version", "app_request", "general"]),
  bundleId: z.string().max(500).optional(),
  appName: z.string().max(500).optional(),
  matchedAppId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type ClientFeedbackSubmitInput = z.infer<typeof clientFeedbackSubmitSchema>;

export const feedbackUpdateSchema = z.object({
  status: z.enum(["new", "triaged", "resolved", "dismissed"]),
});

export type FeedbackUpdateInput = z.infer<typeof feedbackUpdateSchema>;
