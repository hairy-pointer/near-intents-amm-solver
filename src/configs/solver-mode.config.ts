export enum SolverMode {
  PUBLIC = 'public',
  CONFIDENTIAL = 'confidential',
}

export function parseSolverMode(value: string | undefined): SolverMode {
  if (!value) {
    return SolverMode.PUBLIC;
  }
  if (value === SolverMode.PUBLIC || value === SolverMode.CONFIDENTIAL) {
    return value;
  }
  throw new Error(`Unsupported SOLVER_MODE '${value}'`);
}

export const solverMode = parseSolverMode(process.env.SOLVER_MODE);
export const isConfidentialMode = solverMode === SolverMode.CONFIDENTIAL;
