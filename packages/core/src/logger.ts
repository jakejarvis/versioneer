type LogContext = Record<string, unknown>;

export interface Logger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(context: LogContext): Logger;
}

function serializeError(ctx: LogContext): LogContext {
  const { error, ...rest } = ctx;
  if (error instanceof Error) {
    return { ...rest, errorMessage: error.message, errorName: error.name };
  }
  if (error !== undefined) {
    return { ...rest, errorMessage: String(error) };
  }
  return rest;
}

function emit(
  method: typeof console.log,
  level: string,
  message: string,
  baseCtx: LogContext,
  callCtx?: LogContext,
): void {
  method(
    JSON.stringify({
      level,
      message,
      ts: new Date().toISOString(),
      ...baseCtx,
      ...(callCtx ? serializeError(callCtx) : {}),
    }),
  );
}

export function createLogger(baseContext: LogContext = {}): Logger {
  return {
    info: (msg, ctx) => emit(console.log, "info", msg, baseContext, ctx),
    warn: (msg, ctx) => emit(console.warn, "warn", msg, baseContext, ctx),
    error: (msg, ctx) => emit(console.error, "error", msg, baseContext, ctx),
    child: (ctx) => createLogger({ ...baseContext, ...ctx }),
  };
}
