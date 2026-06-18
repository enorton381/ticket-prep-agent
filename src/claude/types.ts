export interface TicketEvaluation {
  shouldPrepare: boolean; // Should we prepare a branch and CONTEXT.md?
  workType: string; // e.g., "bug fix", "documentation", "feature development"
  reasoning: string;
  confidence: number; // 0-1
  concerns: string[];
}

export interface RepositorySelectionResult {
  repositoryIndex: number; // 0-based index into the repositories array
  repositoryName: string;
  reasoning: string;
  confidence: number; // 0-1
}

export interface BaseBranchSelectionResult {
  selectedBranch: string;
  reasoning: string;
  confidence: number; // 0-1
}
