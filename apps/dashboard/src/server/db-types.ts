import { createDb } from "@versioneer/db";

export type Db = ReturnType<typeof createDb>;
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbExecutor = Db | DbTx;
