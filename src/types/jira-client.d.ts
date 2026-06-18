declare module 'jira-client' {
  interface JiraApiOptions {
    protocol?: string;
    host: string;
    port?: string | number;
    username?: string;
    password?: string;
    apiVersion?: string;
    base?: string;
    strictSSL?: boolean;
    oauth?: {
      consumer_key: string;
      consumer_secret: string;
      access_token: string;
      access_token_secret: string;
    };
    bearer?: string;
  }

  interface JiraUser {
    accountId: string;
    displayName: string;
    emailAddress?: string;
    active?: boolean;
  }

  interface JiraIssue {
    id: string;
    key: string;
    fields: {
      summary: string;
      description?: string;
      created: string;
      updated: string;
      assignee?: JiraUser | null;
      reporter?: JiraUser;
      status?: {
        name: string;
        id: string;
      };
      [key: string]: any;
    };
  }

  interface JiraSearchResult {
    issues: JiraIssue[];
    total: number;
    maxResults: number;
    startAt: number;
  }

  class JiraApi {
    constructor(options: JiraApiOptions);

    getCurrentUser(): Promise<JiraUser>;

    searchJira(
      jql: string,
      options?: {
        maxResults?: number;
        startAt?: number;
        fields?: string[];
      }
    ): Promise<JiraSearchResult>;

    updateAssignee(issueKey: string, assignee: string): Promise<any>;

    addComment(issueKey: string, comment: string): Promise<any>;

    getIssue(issueKey: string): Promise<JiraIssue>;

    [key: string]: any;
  }

  export default JiraApi;
}
