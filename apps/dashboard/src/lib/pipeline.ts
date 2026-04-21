import { env } from "cloudflare:workers";

import type { PipelineWorkerStub, SourcePipelineWorkflow } from "@/env";

/**
 * Typed accessor for the pipeline worker service binding.
 * The generated Env types only include `Fetcher` for service bindings —
 * this wrapper provides the RPC method types.
 */
export const pipelineWorker = env.PIPELINE_WORKER as PipelineWorkerStub;

/**
 * Typed accessor for the source pipeline Workflow binding.
 * The generated Env types only include unparameterized `Workflow` —
 * this wrapper provides the payload type for `create()` calls.
 */
export const sourcePipeline = env.SOURCE_PIPELINE as SourcePipelineWorkflow;
