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
    WORKER["versioneer-worker<br/>cron + Workflows"]:::service
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
    D1[("D1<br/>catalog · releases · sources · discovery<br/>trust assertions · installs · feedback · audit")]:::store
    R2[("R2<br/>RAW_BUCKET · ASSETS_BUCKET")]:::store
    KV[("KV<br/>CACHE_KV · CONFIG_KV")]:::store
    WF["Cloudflare Workflows<br/>SourcePipelineWorkflow"]:::infra
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

  %% Worker internals
  WORKER --> PARSERS
  WORKER --> PIPELINE
  WORKER --> SUPPORT
  WORKER --> DBPKG
  WORKER <--> D1
  WORKER <--> R2
  WORKER <--> KV
  WORKER --> WF

  %% Worker ingestion
  WORKER -.->|"poll + fetch + parse"| SPARKLE
  WORKER -.->|"poll + fetch + parse"| GITHUB
  WORKER -.->|"poll + fetch + parse"| MAS
  WORKER -.->|"cask index sync"| BREW
```

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

## Catalog ingestion pipeline

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
  end

  %% Main worker orchestration
  subgraph ORCH["Worker orchestration"]
    direction TB
    DUE["Load active sources + operational state"]:::worker
    PICK{"Which job type?"}:::decision
    POLL["Source polling dispatcher"]:::worker
    ENRICH["Discovery enrichment dispatcher"]:::worker
    CASK["Cask index sync"]:::worker
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
    D1[("D1<br/>sources · sourceFetches · parserRuns<br/>releases · artifacts · appLatestReleases<br/>discoveredApps · jobFailures · audit")]:::store
    R2[("RAW_BUCKET")]:::store
    KV[("CONFIG_KV / CACHE_KV<br/>ETags · sync timestamps · cask index")]:::store
    WF["Cloudflare Workflows"]:::infra
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
  RPC --> PICK
  PICK -->|"due tracked sources"| POLL
  PICK -->|"pending discovered apps"| ENRICH
  PICK -->|"6h cask refresh"| CASK

  %% Polling path
  POLL -->|"dispatch source pipeline"| WF
  WF --> START

  %% Enrichment path
  ENRICH --> LOAD_DISC
  SCORE --> D1

  %% Cask path
  CASK --> BREW
  CASK --> KV

  %% Shared package use
  POLL --> PIPELINE
  ENRICH --> PIPELINE
  FLOW --> PARSERS
  FLOW --> SUPPORT
  FLOW --> DBPKG
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
