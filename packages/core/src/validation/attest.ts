import { z } from "zod";

export const attestChallengeResponseSchema = z.object({
  challenge: z.string(),
});

export const attestRequestSchema = z.object({
  keyId: z.string().min(1),
  attestation: z.string().min(1),
  challenge: z.string().min(1),
});

export const attestRefreshRequestSchema = z.object({
  keyId: z.string().min(1),
  assertion: z.string().min(1),
  challenge: z.string().min(1),
});

export const attestResponseSchema = z.object({
  token: z.string(),
  deviceId: z.string(),
  expiresAt: z.string(),
});

export type AttestRequest = z.infer<typeof attestRequestSchema>;
export type AttestRefreshRequest = z.infer<typeof attestRefreshRequestSchema>;
export type AttestResponse = z.infer<typeof attestResponseSchema>;
