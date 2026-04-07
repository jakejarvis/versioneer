import { z } from "zod";

import { feedbackStatusSchema, feedbackTypeSchema } from "@versioneer/schemas/feedback";

export const clientFeedbackSubmitSchema = z.object({
  feedbackType: feedbackTypeSchema,
  bundleId: z.string().max(500).optional(),
  appName: z.string().max(500).optional(),
  matchedAppId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type ClientFeedbackSubmitInput = z.infer<typeof clientFeedbackSubmitSchema>;

export const feedbackUpdateSchema = z.object({
  status: feedbackStatusSchema,
});

export type FeedbackUpdateInput = z.infer<typeof feedbackUpdateSchema>;
