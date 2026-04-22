# Architecture

> [!WARNING]
> Most of the code in this repo was written by me, a human. These diagrams, however, were _very_ much not...

## App & service boundaries

```mermaid
flowchart TB
  %% Styles
  classDef client fill:#1a1a2e,stroke:#e94560,color:#fff
  classDef helper fill:#2d1b55,stroke:#9b5de5,color:#fff
  classDef service fill:#16213e,stroke:#0f3460,color:#fff
  classDef package fill:#243b53,stroke:#5c7cfa,color:#fff
  classDef store fill:#0f3460,stroke:#e94560,color:#fff
  classDef infra fill:#3a3a3a,stroke:#888,color:#fff
  classDef external fill:#222,stroke:#666,color:#aaa

  %% Desktop
  subgraph DESKTOP["Desktop application"]
    direction TB
    APP["Versioneer.app<br/>SwiftUI macOS app"]:::client
    HELPER["VersioneerPrivilegedHelper<br/>LaunchDaemon + XPC"]:::helper
  end

  %% Operations
  subgraph OPS["Operations"]
    direction TB
    ADMIN["versioneer-admin<br/>TanStack React Start SSR"]:::client
  end

  %% Backend
  subgraph SERVICES["Backend services"]
    direction LR
    API["versioneer-api<br/>Hono HTTP API<br/>/v1/* · /health"]:::service
    WORKER["versioneer-worker<br/>cron + queue consumer + Workflows"]:::service
  end

  %% Shared packages
  subgraph PACKAGES["Shared monorepo packages"]
    direction TB

    subgraph CORE["packages/core"]
      direction TB
      IDENTITY["identity<br/>alias matching + normalization"]:::package
      PARSERS["parsers<br/>registry + adapters"]:::package
      PIPELINE["pipeline<br/>fetch · parse · recompute · enrich"]:::package
      SUPPORT["versioning · validation · dates · cache · logging"]:::package
    end

    DBPKG["packages/db<br/>Drizzle schema definitions"]:::package
  end

  %% Data / infra
  subgraph DATA["Cloudflare data + infrastructure"]
    direction LR
    D1[("D1<br/>catalog · releases · sources · discovery<br/>inventory_followup_jobs · job_failures · audit")]:::store
    R2[("R2<br/>RAW_BUCKET private payloads/source bodies<br/>ASSETS_BUCKET public icons")]:::store
    KV[("KV<br/>CACHE_KV · CONFIG_KV")]:::store
    QUEUE["Cloudflare Queues<br/>INVENTORY_FOLLOWUP_QUEUE<br/>+ environment DLQ"]:::infra
    WF["Cloudflare Workflows<br/>SourcePipeline · EnrichmentDrain · InventoryFollowup"]:::infra
  end

  %% External
  subgraph EXTERNAL["External systems"]
    direction TB
    SPARKLE["Sparkle feeds"]:::external
    GITHUB["GitHub Releases"]:::external
    MAS["Mac App Store / iTunes API"]:::external
    BREW["Homebrew"]:::external
  end

  %% Desktop relationships
  APP -->|"scan inventory + submit metadata"| API
  APP -.->|"local checks:<br/>SparkleChecker · ElectronChecker<br/>AppStoreChecker · HomebrewChecker"| SPARKLE
  APP -.-> GITHUB
  APP -.-> MAS
  APP -.-> BREW
  APP <-->|"XPC for privileged install operations"| HELPER

  %% Operations relationships
  ADMIN -->|"admin API + auth-backed ops UI"| API
  ADMIN -->|"service binding RPC<br/>manual reparse / recompute / retry"| WORKER

  %% API internals
  API --> IDENTITY
  API --> SUPPORT
  API --> DBPKG
  API <--> D1
  API <--> KV
  API -->|"private inventory follow-up payloads"| R2
  API -->|"enqueue { jobId }"| QUEUE

  %% Worker internals
  WORKER --> PARSERS
  WORKER --> PIPELINE
  WORKER --> SUPPORT
  WORKER --> DBPKG
  WORKER <--> D1
  WORKER <--> R2
  WORKER <--> KV
  WORKER --> WF
  QUEUE -->|"consume follow-up messages"| WORKER
  WORKER -->|"repair stale pending/failed jobs"| QUEUE

  %% Worker ingestion
  WORKER -.->|"poll + fetch + parse"| SPARKLE
  WORKER -.->|"poll + fetch + parse"| GITHUB
  WORKER -.->|"poll + fetch + parse"| MAS
  WORKER -.->|"cask index sync"| BREW
```

## Cloudflare resource ownership

| Surface             | Cloudflare bindings / responsibilities                                                                                                                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `versioneer-api`    | HTTP validation, inventory decisions, synchronous `discovered_apps` writes, `DB`, `CACHE_KV`, `CONFIG_KV`, `RAW_BUCKET`, and producer-only `INVENTORY_FOLLOWUP_QUEUE`. It does not write public icons.                                                                     |
| `versioneer-worker` | Scheduled source polling, service-binding RPC, queue consumption, `DB`, `RAW_BUCKET`, `ASSETS_BUCKET`, `CACHE_KV`, `CONFIG_KV`, producer + consumer `INVENTORY_FOLLOWUP_QUEUE`, and the `SOURCE_PIPELINE`, `ENRICHMENT_DRAIN`, and `INVENTORY_FOLLOWUP` Workflow bindings. |
| `versioneer-admin`  | Operational UI over the API plus service-binding RPC to `versioneer-worker`. The failure queue includes `inventory_followup` jobs and can ask the worker to re-enqueue them. Dashboard asset routes read from `ASSETS_BUCKET`.                                             |

`RAW_BUCKET` is for private durable inputs such as fetched source bodies and inventory follow-up payloads. `ASSETS_BUCKET` is for final public assets such as catalog and discovery icons.

## Update decision → execution flows

```mermaid
flowchart TB
  %% Styles
  classDef app fill:#1a1a2e,stroke:#e94560,color:#fff
  classDef api fill:#16213e,stroke:#0f3460,color:#fff
  classDef helper fill:#2d1b55,stroke:#9b5de5,color:#fff
  classDef ext fill:#222,stroke:#666,color:#aaa
  classDef store fill:#0f3460,stroke:#e94560,color:#fff
  classDef decision fill:#533483,stroke:#e94560,color:#fff
  classDef highlight fill:#e94560,stroke:#fff,color:#fff

  %% External / backend pieces used by desktop
  API["versioneer-api<br/>inventory + install endpoints"]:::api
  HELPER["VersioneerPrivilegedHelper<br/>XPC privileged operations"]:::helper
  CACHE[("ScanCacheStore")]:::store

  SPARKLE["Sparkle feeds"]:::ext
  GITHUB["GitHub Releases / latest-mac.yml"]:::ext
  MAS["iTunes / App Store lookup"]:::ext
  BREW["brew CLI + formula/cask metadata"]:::ext

  %% Desktop flow
  subgraph DESKTOP["Versioneer.app"]
    direction TB

    SCAN["AppScanner<br/>scan /Applications + utilities + running apps"]:::app
    META["BundleMetadataReader<br/>bundle ID · version · team ID · arch<br/>Sparkle URL · MAS receipt · Electron config · brew linkage"]:::app
    LOCAL["Run local checker actors in parallel<br/>SparkleChecker · ElectronChecker<br/>AppStoreChecker · HomebrewChecker"]:::app

    SEND["InventoryAPIClient<br/>gzip POST /v1/inventory/check"]:::app
    MERGE["AppState merges API decisions<br/>with local checker results"]:::highlight

    DECIDE{"Decision status"}:::decision
    UTD["up_to_date"]:::app
    LOCALONLY["local_only / fallback result"]:::app
    UPDATE["update_available"]:::app
    AMBIG["ambiguous"]:::app

    PRESENT["Presentation layer<br/>InstallPresentation · StatusBarPresentation · UI state"]:::app

    PREP["Request install preparation"]:::app
    DOWNLOAD["InstallCoordinator<br/>download artifact to staging"]:::app
    VERIFY["Verify artifact<br/>SHA-256 · codesign · spctl<br/>bundle ID + team ID"]:::app
    ROUTE{"Install strategy / execution route"}:::decision

    SPARKLE_I["Delegate to app's Sparkle updater"]:::app
    LOCAL_R["Local replace<br/>zip / dmg copy-replace"]:::app
    PRIV_R["Privileged replace / pkg / brew / mas"]:::app
    RELAUNCH["Relaunch app + flush bundle caches"]:::app
    RESCAN["Trigger rescan"]:::app

    SCAN --> META --> LOCAL
    META --> SEND
    LOCAL --> MERGE
    SEND --> MERGE
    MERGE --> DECIDE

    DECIDE --> UTD --> PRESENT
    DECIDE --> LOCALONLY --> PRESENT
    DECIDE --> AMBIG --> PRESENT
    DECIDE --> UPDATE --> PRESENT

    UPDATE --> PREP --> DOWNLOAD --> VERIFY --> ROUTE
    ROUTE -->|"sparkle"| SPARKLE_I --> RELAUNCH
    ROUTE -->|"zipReplace / dmgCopyReplace<br/>writable target"| LOCAL_R --> RELAUNCH
    ROUTE -->|"pkgInstall / homebrew / mas<br/>or protected target"| PRIV_R --> RELAUNCH

    RELAUNCH --> RESCAN --> SCAN
  end

  %% Local checker dependencies
  LOCAL -.-> SPARKLE
  LOCAL -.-> GITHUB
  LOCAL -.-> MAS
  LOCAL -.-> BREW

  %% API / helper connections
  SEND --> API
  PREP --> API
  PRIV_R <--> HELPER

  %% Cache / fallback
  MERGE <--> CACHE
```

## Inventory follow-up handoff

`POST /v1/inventory/check` remains a synchronous inventory decision endpoint from the desktop client's perspective. The API still validates the scan, computes decisions, and persists `discovered_apps` before returning the response. Everything after that becomes a durable private handoff:

1. The API builds a compact follow-up payload containing only discovered-app icon candidates and matched catalog-app suggestion/icon candidates.
2. The payload is stored in `RAW_BUCKET` under `inventory-followups/YYYY/MM/DD/<jobId>.json`.
3. D1 records an `inventory_followup_jobs` row with `pending | queued | running | completed | failed`, `payloadR2Key`, `workflowInstanceId`, `attemptCount`, item counters, errors, and timestamps.
4. The queue message is only `{ jobId }`, keeping Cloudflare Queues payloads small and making D1/R2 the durable source of truth.
5. If enqueue fails after the D1 row is written, the desktop response still returns, the job stays `pending`, and `job_failures` records `inventory_followup` with the `enqueue` key.
6. The worker queue handler claims `pending` or retryable `failed` jobs, increments the attempt count, creates deterministic Workflow instance IDs as `<jobId>-<attempt>`, and acks the message only after Workflow creation succeeds. Completed, queued, and running jobs are acked as duplicate-safe no-ops.
7. The scheduled worker repairs stale `pending` or retryable `failed` jobs by re-enqueuing them. Queue, handoff, repair, and Workflow failures are recorded in `job_failures` as `inventory_followup`.

`InventoryFollowupWorkflow` owns the async work that used to live behind the API route: icon storage, catalog icon backfill, inventory-match snapshot invalidation, alias/source/trust suggestions, and suggestion evidence. Successful runs mark the D1 job completed, resolve related failures, and delete the private R2 payload. Failed runs mark the job failed and keep the payload for retry/debugging.

## Catalog ingestion and follow-up pipeline

```mermaid
flowchart TB
  %% Styles
  classDef worker fill:#16213e,stroke:#0f3460,color:#fff
  classDef package fill:#243b53,stroke:#5c7cfa,color:#fff
  classDef store fill:#0f3460,stroke:#e94560,color:#fff
  classDef infra fill:#3a3a3a,stroke:#888,color:#fff
  classDef external fill:#222,stroke:#666,color:#aaa
  classDef decision fill:#533483,stroke:#e94560,color:#fff
  classDef ops fill:#2d1b55,stroke:#9b5de5,color:#fff

  %% Entry points
  subgraph ENTRY["versioneer-worker entry points"]
    direction TB
    CRON["scheduled()<br/>cron trigger every 15 min"]:::worker
    RPC["RPC / service binding calls<br/>from versioneer-admin"]:::ops
    QUEUE_IN["queue(batch)<br/>INVENTORY_FOLLOWUP_QUEUE"]:::worker
  end

  %% Main worker orchestration
  subgraph ORCH["Worker orchestration"]
    direction TB
    DUE["Load active sources + operational state"]:::worker
    PICK{"Which job type?"}:::decision
    POLL["Source polling dispatcher"]:::worker
    ENRICH["Discovery enrichment dispatcher"]:::worker
    CASK["Cask index sync"]:::worker
    REPAIR["Inventory follow-up repair"]:::worker
    FOLLOWUP["Inventory follow-up queue handler"]:::worker
  end

  %% Workflow pipeline
  subgraph FLOW["SourcePipelineWorkflow"]
    direction TB
    START["Start workflow for due source"]:::infra
    FETCH["Fetch source body<br/>ETag / Last-Modified / SHA-256"]:::worker
    STORE["Persist raw body to RAW_BUCKET"]:::worker
    PARSE["Lookup parser by parserKey<br/>and parse source payload"]:::worker
    UPSERT["Upsert observations, releases,<br/>artifacts, parser runs, source fetches"]:::worker
    RECOMP["Recompute appLatestReleases<br/>per app + channel"]:::worker

    START --> FETCH --> STORE --> PARSE --> UPSERT --> RECOMP
  end

  %% Inventory follow-up workflow
  subgraph IFLOW["InventoryFollowupWorkflow"]
    direction TB
    IF_START["Start workflow for claimed jobId"]:::infra
    IF_LOAD["Load inventory_followup_jobs row<br/>and RAW_BUCKET payload"]:::worker
    IF_DISC_ICONS["Store discovered-app icons<br/>ASSETS_BUCKET icons/&lt;hash&gt;.png"]:::worker
    IF_CATALOG_ICONS["Backfill catalog app icons<br/>delete match snapshot if icon changed"]:::worker
    IF_SUGGEST["Create alias, source,<br/>and trust suggestions + evidence"]:::worker
    IF_DONE["Mark completed<br/>resolve failure · delete payload"]:::worker

    IF_START --> IF_LOAD --> IF_DISC_ICONS --> IF_CATALOG_ICONS --> IF_SUGGEST --> IF_DONE
  end

  %% Discovery enrichment
  subgraph DISCOVERY["Discovery enrichment"]
    direction TB
    LOAD_DISC["Load pending discoveredApps<br/>batch ordered by priority"]:::worker
    ENRICH_ONE["enrichDiscoveredApp()<br/>try Sparkle, GitHub, homepage metadata"]:::worker
    SCORE["Update enrichment status,<br/>confidence, and discovered metadata"]:::worker

    LOAD_DISC --> ENRICH_ONE --> SCORE
  end

  %% Parser / shared package view
  subgraph PACKAGES["Shared package subsystems used by worker"]
    direction TB
    PIPELINE["packages/core/pipeline"]:::package
    PARSERS["packages/core/parsers<br/>registry + adapters"]:::package
    SUPPORT["versioning · dates · cache · logging"]:::package
    DBPKG["packages/db schema"]:::package
  end

  %% Data / infra
  subgraph DATA["Cloudflare data + infrastructure"]
    direction LR
    D1[("D1<br/>sources · source_fetches · parser_runs<br/>releases · artifacts · app_latest_releases<br/>discovered_apps · inventory_followup_jobs<br/>job_failures · audit")]:::store
    R2[("RAW_BUCKET · ASSETS_BUCKET")]:::store
    KV[("CONFIG_KV / CACHE_KV<br/>ETags · sync timestamps · cask index")]:::store
    Q[["INVENTORY_FOLLOWUP_QUEUE<br/>{ jobId } messages<br/>10 batch · 5s timeout · 5 retries · 60s delay"]]:::infra
    WF["Cloudflare Workflows<br/>SourcePipeline · EnrichmentDrain · InventoryFollowup"]:::infra
  end

  %% External systems
  subgraph EXTERNAL["External systems"]
    direction TB
    SPARKLE["Sparkle feeds"]:::external
    GITHUB["GitHub Releases"]:::external
    MAS["Mac App Store feeds / APIs"]:::external
    BREW["Homebrew cask index"]:::external
    WEB["Vendor web pages / generic sources"]:::external
  end

  %% Scheduling / orchestration edges
  CRON --> DUE --> PICK
  CRON --> REPAIR
  RPC --> PICK
  QUEUE_IN --> FOLLOWUP
  PICK -->|"due tracked sources"| POLL
  PICK -->|"pending discovered apps"| ENRICH
  PICK -->|"6h cask refresh"| CASK

  %% Polling path
  POLL -->|"dispatch source pipeline"| WF
  WF --> START
  FOLLOWUP -->|"claim pending/failed job"| D1
  FOLLOWUP -->|"create deterministic instance"| WF
  WF --> IF_START

  %% Enrichment path
  ENRICH --> LOAD_DISC
  SCORE --> D1

  %% Cask path
  CASK --> BREW
  CASK --> KV

  %% Inventory follow-up path
  REPAIR -->|"re-enqueue stale pending/failed jobs"| Q
  Q --> QUEUE_IN
  IF_LOAD <--> D1
  IF_LOAD --> R2
  IF_DISC_ICONS <--> D1
  IF_DISC_ICONS --> R2
  IF_CATALOG_ICONS <--> D1
  IF_CATALOG_ICONS --> R2
  IF_CATALOG_ICONS <--> KV
  IF_SUGGEST <--> D1
  IF_DONE <--> D1
  IF_DONE --> R2

  %% Shared package use
  POLL --> PIPELINE
  ENRICH --> PIPELINE
  FOLLOWUP --> PIPELINE
  FLOW --> PARSERS
  FLOW --> SUPPORT
  FLOW --> DBPKG
  IFLOW --> SUPPORT
  IFLOW --> DBPKG
  DISCOVERY --> SUPPORT

  %% Data edges
  DUE <--> D1
  DUE <--> KV
  FETCH --> R2
  STORE --> R2
  UPSERT <--> D1
  RECOMP <--> D1

  %% External fetch/parse edges
  FETCH -.-> SPARKLE
  FETCH -.-> GITHUB
  FETCH -.-> MAS
  FETCH -.-> WEB
  ENRICH_ONE -.-> SPARKLE
  ENRICH_ONE -.-> GITHUB
  ENRICH_ONE -.-> WEB
```
