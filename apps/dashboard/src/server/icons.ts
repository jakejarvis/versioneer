import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import { apps, auditLog, generateId, idPrefixes } from "@versioneer/schema";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { authMiddleware } from "./middleware";

const ALLOWED_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const MAX_SIZE_BYTES = 512 * 1024; // 512KB

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

async function computeHash(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}

export const uploadAppIcon = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      appId: z.string().min(1),
      fileBase64: z.string().min(1),
      contentType: z.enum(ALLOWED_CONTENT_TYPES),
    }),
  )
  .handler(async ({ data, context }) => {
    const db = createDb(env.DB);

    const app = await db.select().from(apps).where(eq(apps.id, data.appId)).get();
    if (!app) throw new Error("App not found");

    const binaryString = atob(data.fileBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const body = bytes.buffer as ArrayBuffer;

    if (body.byteLength > MAX_SIZE_BYTES) {
      throw new Error(`File too large: ${body.byteLength} bytes (max ${MAX_SIZE_BYTES})`);
    }

    const hash = await computeHash(body);
    const ext = CONTENT_TYPE_TO_EXT[data.contentType];
    const r2Key = `icons/${hash}.${ext}`;

    await (env as unknown as { ASSETS_BUCKET: R2Bucket }).ASSETS_BUCKET.put(r2Key, body, {
      httpMetadata: {
        contentType: data.contentType,
        cacheControl: "public, max-age=31536000, immutable",
      },
    });

    const previousKey = app.iconR2Key;
    const now = new Date().toISOString();

    await db.update(apps).set({ iconR2Key: r2Key, updatedAt: now }).where(eq(apps.id, data.appId));

    if (previousKey && previousKey !== r2Key) {
      await (env as unknown as { ASSETS_BUCKET: R2Bucket }).ASSETS_BUCKET.delete(previousKey);
    }

    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "app_icon_uploaded",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "app",
      targetId: data.appId,
      payloadJson: JSON.stringify({ r2Key, previousKey }),
      createdAt: now,
    });

    return { iconR2Key: r2Key };
  });

export const deleteAppIcon = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ appId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    const db = createDb(env.DB);

    const app = await db.select().from(apps).where(eq(apps.id, data.appId)).get();
    if (!app) throw new Error("App not found");
    if (!app.iconR2Key) throw new Error("App has no icon");

    await (env as unknown as { ASSETS_BUCKET: R2Bucket }).ASSETS_BUCKET.delete(app.iconR2Key);

    const now = new Date().toISOString();
    await db.update(apps).set({ iconR2Key: null, updatedAt: now }).where(eq(apps.id, data.appId));

    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "app_icon_deleted",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "app",
      targetId: data.appId,
      payloadJson: JSON.stringify({ deletedKey: app.iconR2Key }),
      createdAt: now,
    });

    return { status: "deleted" };
  });
