export class ResponseBodyTooLargeError extends Error {
  readonly maxBytes: number;
  readonly actualBytes: number | null;

  constructor(maxBytes: number, actualBytes: number | null = null) {
    super(
      actualBytes === null
        ? `Response body exceeds ${maxBytes} bytes`
        : `Response body too large: ${actualBytes} bytes (max ${maxBytes})`,
    );
    this.name = "ResponseBodyTooLargeError";
    this.maxBytes = maxBytes;
    this.actualBytes = actualBytes;
  }
}

export async function readResponseTextLimited(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; bytesRead: number }> {
  const contentLengthHeader = response.headers.get("content-length");
  const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : Number.NaN;
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ResponseBodyTooLargeError(maxBytes, contentLength);
  }

  if (!response.body) {
    const text = await response.text();
    const bytesRead = new TextEncoder().encode(text).byteLength;
    if (bytesRead > maxBytes) {
      throw new ResponseBodyTooLargeError(maxBytes, bytesRead);
    }
    return { text, bytesRead };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytesRead = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      await reader.cancel();
      throw new ResponseBodyTooLargeError(maxBytes, bytesRead);
    }

    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return { text, bytesRead };
}

export async function readResponseArrayBufferLimited(
  response: Response,
  maxBytes: number,
): Promise<{ buffer: ArrayBuffer; bytesRead: number }> {
  const contentLengthHeader = response.headers.get("content-length");
  const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : Number.NaN;
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ResponseBodyTooLargeError(maxBytes, contentLength);
  }

  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new ResponseBodyTooLargeError(maxBytes, buffer.byteLength);
    }
    return { buffer, bytesRead: buffer.byteLength };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      await reader.cancel();
      throw new ResponseBodyTooLargeError(maxBytes, bytesRead);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { buffer: bytes.buffer, bytesRead };
}
