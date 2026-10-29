// The digest's contract (plan.md § 1). Section 2 (page, JSON, board link, route tests) builds
// against this file only, so it is committed before the reader itself.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One row per job in a night's run log. Times keep the log's own offset (styleguide).
export type DigestRow = {
  job: string;
  owner: string | null; // views show `—` for null
  runs: number; // every parsed line for the job, retries and fails included
  retries: number; // lines with status `retry`
  fails: number; // lines with status `fail`
  lastStatus: RunStatus;
  lastError: string | null; // last non-empty `error` seen that night; views show `—` for null
  firstAt: string;
  lastAt: string;
  marked: boolean; // retries >= 3 or any fail; page and JSON read the same flag
};

export type Night = {
  night: string; // YYYY-MM-DD, the file name: lines after midnight belong to the same night
  rows: DigestRow[]; // sorted by job
  counts: Record<RunStatus, number>; // parsed lines per status, for the board link
  badLines: number; // lines that didn't parse: counted, never thrown
};

// Reads <runsDir>/<night>.jsonl. Returns null when the night has no file or `night` isn't
// YYYY-MM-DD (no path outside runsDir). Implemented in ./reader.ts.
export type ReadNight = (runsDir: string, night: string) => Night | null;

export const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
