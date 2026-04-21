import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import { createLogger } from "@versioneer/core/logger";
import {
  handleSourceFetch,
  handleSourceParse,
  handleRecomputeLatest,
} from "@versioneer/core/pipeline";
import type { FetchStepResult, ParseStepResult, SourceFetchJob } from "@versioneer/core/pipeline";
// Import parsers to trigger auto-registration
import "@versioneer/core/parsers";

export class SourcePipelineWorkflow extends WorkflowEntrypoint<Env, SourceFetchJob> {
  async run(event: WorkflowEvent<SourceFetchJob>, step: WorkflowStep) {
    const { sourceId, reason, force } = event.payload;
    const log = createLogger({ workflow: "source-pipeline", sourceId, reason, force });

    log.info("workflow started");

    try {
      const fetchResult = await step.do<FetchStepResult>(
        "fetch-source",
        { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
        async () => {
          const stepLog = log.child({ step: "fetch-source" });
          const start = Date.now();
          try {
            const result = await handleSourceFetch(
              { sourceId, reason, force, idempotencyKey: event.instanceId },
              this.env,
            );
            stepLog.info("step completed", {
              durationMs: Date.now() - start,
              shouldParse: result.shouldParse,
              sourceFetchId: result.sourceFetchId,
            });
            return result;
          } catch (err) {
            stepLog.error("step failed", { durationMs: Date.now() - start, error: err });
            throw err;
          }
        },
      );

      if (!fetchResult.shouldParse || !fetchResult.sourceFetchId) {
        log.info("workflow completed early", { reason: "nothing-to-parse" });
        return { status: "completed", step: "fetch", reason: "nothing-to-parse" };
      }

      const parseResult = await step.do<ParseStepResult>(
        "parse-source",
        { retries: { limit: 2, delay: "2 seconds", backoff: "exponential" } },
        async () => {
          const stepLog = log.child({ step: "parse-source" });
          const start = Date.now();
          try {
            const result = await handleSourceParse(
              { sourceFetchId: fetchResult.sourceFetchId! },
              this.env,
            );
            stepLog.info("step completed", {
              durationMs: Date.now() - start,
              releaseCount: result.releaseCount,
            });
            return result;
          } catch (err) {
            stepLog.error("step failed", { durationMs: Date.now() - start, error: err });
            throw err;
          }
        },
      );

      await step.do("recompute-latest", { retries: { limit: 2, delay: "1 second" } }, async () => {
        const stepLog = log.child({ step: "recompute-latest" });
        const start = Date.now();
        try {
          await handleRecomputeLatest({ appId: parseResult.appId }, this.env);
          stepLog.info("step completed", { durationMs: Date.now() - start });
        } catch (err) {
          stepLog.error("step failed", { durationMs: Date.now() - start, error: err });
          throw err;
        }
      });

      log.info("workflow completed", { releaseCount: parseResult.releaseCount });

      return {
        status: "completed",
        step: "recompute",
        releaseCount: parseResult.releaseCount,
      };
    } catch (err) {
      log.error("workflow failed", { error: err });
      throw err;
    }
  }
}
