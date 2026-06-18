import JiraApi from 'jira-client';
import { config } from '../config.js';
import { logger } from '../logger.js';

// initialize Jira Client

export class JiraClient {
  private client: JiraApi;
  private userAccountId: string | null = null;

  constructor() {
    // Extract just the hostname from the base URL (e.g., "vestmark.atlassian.net")
    const hostname = config.jira.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

    this.client = new JiraApi({
      protocol: 'https',
      host: hostname,
      username: config.jira.email,
      password: config.jira.apiToken,
      apiVersion: '3', // API v3 required for search/jql endpoint
    });
  }

  async initialize(): Promise<void> {
    try {
      const user = await this.client.getCurrentUser();
      this.userAccountId = user.accountId;
      logger.info(`Initialized Jira client for user: ${user.displayName} (${user.accountId})`);
    } catch (error) {
      logger.error('Failed to initialize Jira client:', error);
      throw new Error('Failed to connect to Jira. Please check your credentials.');
    }
  }

  getUserAccountId(): string {
    if (!this.userAccountId) {
      throw new Error('Jira client not initialized. Call initialize() first.');
    }
    return this.userAccountId;
  }

  getClient(): JiraApi {
    return this.client;
  }
}

export const jiraClient = new JiraClient();
