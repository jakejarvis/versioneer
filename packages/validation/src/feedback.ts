import { z } from "zod";

export const clientFeedbackSubmitSchema = z.object({
  installId: z.string().min(1).max(200),
  feedbackType: z.enum(["wrong_match", "wrong_version", "app_request", "general"]),
  snapshotId: z.string().optional(),
  inventoryAppId: z.string().optional(),
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
