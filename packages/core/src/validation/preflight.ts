import { z } from "zod";

export const clientPreflightResponseSchema = z.object({
  dismissedBundleIds: z.array(z.string()),
});

export type ClientPreflightResponse = z.infer<typeof clientPreflightResponseSchema>;
