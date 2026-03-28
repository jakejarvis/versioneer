import { z } from "zod";

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type Pagination = z.infer<typeof paginationSchema>;

export const idParamSchema = z.object({
  id: z.string().min(1),
});

export const channelSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9_-]+$/);
