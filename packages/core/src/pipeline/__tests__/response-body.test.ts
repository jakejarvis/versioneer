import { describe, expect, it } from "vitest";

import { ResponseBodyTooLargeError, readResponseTextLimited } from "../response-body";

describe("ResponseBodyTooLargeError", () => {
  it("formats message with both sizes", () => {
    const err = new ResponseBodyTooLargeError(1000, 2000);
    expect(err.message).toBe("Response body too large: 2000 bytes (max 1000)");
    expect(err.maxBytes).toBe(1000);
    expect(err.actualBytes).toBe(2000);
    expect(err.name).toBe("ResponseBodyTooLargeError");
  });

  it("formats message without actual size", () => {
    const err = new ResponseBodyTooLargeError(1000);
    expect(err.message).toBe("Response body exceeds 1000 bytes");
    expect(err.actualBytes).toBeNull();
  });
});

describe("readResponseTextLimited", () => {
  it("reads body within limit", async () => {
    const body = "Hello, world!";
    const response = new Response(body);
    const result = await readResponseTextLimited(response, 1000);
    expect(result.text).toBe(body);
    expect(result.bytesRead).toBe(new TextEncoder().encode(body).byteLength);
  });

  it("throws when Content-Length header exceeds max", async () => {
    const response = new Response("x", {
      headers: { "Content-Length": "5000" },
    });
    await expect(readResponseTextLimited(response, 1000)).rejects.toThrow(
      ResponseBodyTooLargeError,
    );
  });

  it("throws when streaming body exceeds max mid-stream", async () => {
    const encoder = new TextEncoder();
    const chunks = [encoder.encode("a".repeat(500)), encoder.encode("b".repeat(600))];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
    const response = new Response(stream);
    await expect(readResponseTextLimited(response, 1000)).rejects.toThrow(
      ResponseBodyTooLargeError,
    );
  });

  it("reads response without body using response.text() fallback", async () => {
    const text = "short";
    // Create a response and consume the body, then construct one without a stream
    const response = new Response(text);
    // Override body to null to test the fallback path
    Object.defineProperty(response, "body", { value: null });
    const result = await readResponseTextLimited(response, 1000);
    expect(result.text).toBe(text);
  });

  it("does not throw when Content-Length header is within limit", async () => {
    const body = "OK";
    const response = new Response(body, {
      headers: { "Content-Length": "2" },
    });
    const result = await readResponseTextLimited(response, 1000);
    expect(result.text).toBe(body);
  });

  it("handles multibyte characters correctly", async () => {
    const body = "\u{1F600}".repeat(10); // 10 emoji = 40 bytes
    const response = new Response(body);
    const result = await readResponseTextLimited(response, 1000);
    expect(result.text).toBe(body);
    expect(result.bytesRead).toBe(40);
  });
});
