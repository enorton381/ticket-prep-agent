import { TicketEvaluation } from '../claude/types.js';
import { RepositorySelection, BranchPreparationResult } from '../bitbucket/types.js';

export enum WorkflowState {
  DETECTED = 'detected',
  EVALUATING = 'evaluating',
  AWAITING_USER = 'awaiting_user',
  AWAITING_REPO_INPUT = 'awaiting_repo_input',
  PREPARING_BRANCH = 'preparing_branch',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

export interface WorkflowTicket {
  ticketKey: string;
  state: WorkflowState;
  evaluation?: TicketEvaluation;
  repository?: RepositorySelection;
  result?: BranchPreparationResult;
  error?: string;
  startedAt: string;
  completedAt?: string;
}
