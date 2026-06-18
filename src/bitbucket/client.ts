import https from 'https';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { Repository } from './types.js';

export class BitbucketClient {
  private baseUrl: string;
  private username: string;
  private password: string;
  private authString: string;
  private httpsAgent: https.Agent;

  constructor() {
    this.baseUrl = config.bitbucket.baseUrl;
    this.username = config.bitbucket.username;
    this.password = config.bitbucket.password;
    this.authString = Buffer.from(`${this.username}:${this.password}`).toString('base64');

    // Create HTTPS agent with SSL verification setting
    this.httpsAgent = new https.Agent({
      rejectUnauthorized: config.bitbucket.verifySsl,
    });

    logger.info(`Initialized Bitbucket client for ${this.baseUrl}`);
  }

  async getRepository(project: string, repo: string): Promise<Repository> {
    try {
      logger.info(`Fetching repository ${project}/${repo} from Bitbucket`);

      const url = `${this.baseUrl}/rest/api/1.0/projects/${project}/repos/${repo}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${this.authString}`,
          'Accept': 'application/json',
        },
        // @ts-ignore - fetch in Node.js accepts agent
        agent: this.httpsAgent,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch repository: ${response.status} ${response.statusText}`);
      }

      const repoData: any = await response.json();

      // Extract clone URL (HTTPS)
      const cloneUrl = repoData.links?.clone?.find((link: any) => link.name === 'http')?.href;
      if (!cloneUrl) {
        throw new Error('No HTTPS clone URL found for repository');
      }

      // Inject credentials into clone URL
      const urlWithCredentials = this.addCredentialsToUrl(cloneUrl);

      // Get default branch
      const defaultBranch = await this.getDefaultBranch(project, repo);

      return {
        project,
        repo,
        cloneUrl: urlWithCredentials,
        defaultBranch,
      };
    } catch (error) {
      logger.error(`Failed to get repository ${project}/${repo}:`, error);
      throw error;
    }
  }

  async getDefaultBranch(project: string, repo: string): Promise<string> {
    try {
      const url = `${this.baseUrl}/rest/api/1.0/projects/${project}/repos/${repo}/default-branch`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${this.authString}`,
          'Accept': 'application/json',
        },
        // @ts-ignore
        agent: this.httpsAgent,
      });

      if (!response.ok) {
        // Default to 'master' or 'main' if API call fails
        logger.warn(`Could not fetch default branch, defaulting to 'master'`);
        return 'master';
      }

      const data: any = await response.json();
      return data.displayId || data.id || 'master';
    } catch (error) {
      logger.warn('Failed to get default branch, using master:', error);
      return 'master';
    }
  }

  async listBranches(project: string, repo: string, limit: number = 100): Promise<string[]> {
    try {
      logger.info(`Fetching branches for ${project}/${repo}`);
      const url = `${this.baseUrl}/rest/api/1.0/projects/${project}/repos/${repo}/branches?limit=${limit}`;
      logger.debug(`Branch list URL: ${url}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${this.authString}`,
          'Accept': 'application/json',
        },
        // @ts-ignore
        agent: this.httpsAgent,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.warn(`Failed to fetch branches for ${project}/${repo}: ${response.status} ${response.statusText}`);
        logger.debug(`Error response body: ${errorBody}`);
        return [];
      }

      const data: any = await response.json();
      const branches = data.values?.map((branch: any) => branch.displayId || branch.id) || [];
      logger.info(`Found ${branches.length} branches in ${project}/${repo}`);
      return branches;
    } catch (error) {
      logger.warn(`Failed to list branches for ${project}/${repo}:`, error);
      return [];
    }
  }

  getBranchUrl(project: string, repo: string, branchName: string): string {
    // Bitbucket Server branch URL format
    const encodedBranch = encodeURIComponent(branchName);
    return `${this.baseUrl}/projects/${project}/repos/${repo}/browse?at=${encodedBranch}`;
  }

  private addCredentialsToUrl(url: string): string {
    // Add credentials to clone URL: https://username:password@bitbucket.com/...
    try {
      const urlObj = new URL(url);
      urlObj.username = this.username;
      urlObj.password = this.password;
      return urlObj.toString();
    } catch (error) {
      logger.error('Failed to add credentials to URL:', error);
      return url;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      logger.info('Testing Bitbucket connection...');
      const response = await fetch(`${this.baseUrl}/rest/api/1.0/application-properties`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${this.authString}`,
          'Accept': 'application/json',
        },
        // @ts-ignore
        agent: this.httpsAgent,
      });

      if (response.ok) {
        logger.info('Bitbucket connection successful');
        return true;
      } else {
        logger.error(`Bitbucket connection failed: ${response.status} ${response.statusText}`);
        return false;
      }
    } catch (error) {
      logger.error('Bitbucket connection test failed:', error);
      return false;
    }
  }
}

export const bitbucketClient = new BitbucketClient();
