export interface Repository {
  project: string;
  repo: string;
  cloneUrl: string;
  defaultBranch: string;
}

export interface RepositorySelection {
  project: string;
  repo: string;
  baseBranch?: string; // The branch to branch from (optional, defaults to repository's default branch)
}

export interface BranchPreparationResult {
  branchName: string;
  branchUrl: string;
  contextMdPath: string;
  commitSha: string;
}

export interface GitCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
}
