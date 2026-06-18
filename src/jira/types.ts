export interface JiraTicket {
  key: string;
  id: string;
  summary: string;
  status: string;
  issueType: string;
  created: string;
  url: string;
  boardId?: number;
  boardName?: string;
}

export interface EnhancedJiraTicket extends JiraTicket {
  description: string;
  components: string[];
  labels: string[];
  epicKey?: string;
  acceptanceCriteria?: string;
  customFields?: Record<string, any>;
}

export interface JiraUser {
  accountId: string;
  emailAddress: string;
  displayName: string;
}
