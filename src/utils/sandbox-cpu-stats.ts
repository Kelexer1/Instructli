export interface ExecutionCounters {
  instructions: number;
  redirects: number;
}

export function emptyCounters(): ExecutionCounters {
  return { instructions: 0, redirects: 0 };
}
