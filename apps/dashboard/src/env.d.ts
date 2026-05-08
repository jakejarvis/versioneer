import type {
  EnrichmentDrainJob,
  InventoryIngestionJob,
  RecomputeLatestJob,
  SourceFetchJob,
  SourceParseJob,
} from "@versioneer/core/pipeline";

/**
 * Typed facade for the pipeline worker service binding.
 * Wrangler generates plain `Fetcher` for service bindings but can't infer
 * cross-worker RPC method types, so we declare them here.
 */
export interface PipelineWorkerStub extends Fetcher {
  recomputeLatest(params: RecomputeLatestJob): Promise<void>;
  retryInventoryIngestion(params: InventoryIngestionJob): Promise<void>;
  reparse(params: SourceParseJob): Promise<void>;
}

/**
 * Typed Workflow binding for the source pipeline.
 * Wrangler generates plain `Workflow` without the payload generic,
 * so we declare it here for type-safe `create()` calls.
 */
export type SourcePipelineWorkflow = Workflow<SourceFetchJob>;

/**
 * Typed Workflow binding for the enrichment drain workflow.
 */
export type EnrichmentDrainWorkflow = Workflow<EnrichmentDrainJob>;
