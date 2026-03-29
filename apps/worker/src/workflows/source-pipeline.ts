import {
  handleSourceFetch,
  handleSourceParse,
  handleRecomputeLatest,
} from "@versioneer/core/pipeline";
import type { FetchStepResult, ParseStepResult, SourceFetchJob } from "@versioneer/core/pipeline";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
// Import parsers to trigger auto-registration
import "@versioneer/core/parsers";

export class SourcePipelineWorkflow extends WorkflowEntrypoint<Env, SourceFetchJob> {
  async run(event: WorkflowEvent<SourceFetchJob>, step: WorkflowStep) {
    const { sourceId, reason, force } = event.payload;

    const fetchResult = await step.do<FetchStepResult>(
      "fetch-source",
      { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
      async () => {
        return await handleSourceFetch({ sourceId, reason, force }, this.env as never);
      },
    );

    if (!fetchResult.shouldParse || !fetchResult.sourceFetchId) {
      return { status: "completed", step: "fetch", reason: "nothing-to-parse" };
    }

    const parseResult = await step.do<ParseStepResult>(
      "parse-source",
      { retries: { limit: 2, delay: "2 seconds", backoff: "exponential" } },
      async () => {
        return await handleSourceParse(
          { sourceFetchId: fetchResult.sourceFetchId! },
          this.env as never,
        );
      },
    );

    await step.do("recompute-latest", { retries: { limit: 2, delay: "1 second" } }, async () => {
      await handleRecomputeLatest({ appId: parseResult.appId }, this.env as never);
    });

    return {
      status: "completed",
      step: "recompute",
      releaseCount: parseResult.releaseCount,
    };
  }
}
