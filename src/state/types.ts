import { WorkflowTicket } from '../workflow/state-machine.js';
import { RepositoryConfig } from '../config.js';

export interface State {
  seenTicketKeys: string[];
  lastChecked: string;
  workflows?: Record<string, WorkflowTicket>;
  repositories?: RepositoryConfig[];
}
