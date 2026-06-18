import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export interface RepositoryConfig {
  project: string;
  repo: string;
  defaultFor?: string[];
}

export interface Config {
  jira: {
    baseUrl: string;
    email: string;
    apiToken: string;
    boardIds: number[];
    username: string;
  };
  polling: {
    intervalSeconds: number;
  };
  claude: {
    awsRegion: string;
    awsProfile?: string;
    model: string;
    maxTokens: number;
    temperature: number;
  };
  bitbucket: {
    baseUrl: string;
    username: string;
    password: string;
    verifySsl: boolean;
  };
  workflow: {
    tempDirBase: string;
    cloneTimeoutMs: number;
    maxConcurrentClones: number;
    cleanupAfterHours: number;
  };
  repositories: RepositoryConfig[];
}

function validateEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseBoardIds(boardIdsStr: string): number[] {
  return boardIdsStr
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
    .map((id) => {
      const parsed = parseInt(id, 10);
      if (isNaN(parsed)) {
        throw new Error(`Invalid board ID: ${id}`);
      }
      return parsed;
    });
}

function parseRepositories(reposStr: string): RepositoryConfig[] {
  try {
    const parsed = JSON.parse(reposStr);
    if (!Array.isArray(parsed)) {
      throw new Error('REPOSITORIES must be a JSON array');
    }
    return parsed as RepositoryConfig[];
  } catch (error: any) {
    throw new Error(`Failed to parse REPOSITORIES: ${error.message}`);
  }
}

function loadConfig(): Config {
  const boardIdsStr = validateEnvVar('JIRA_BOARD_IDS');
  const boardIds = parseBoardIds(boardIdsStr);

  if (boardIds.length === 0) {
    throw new Error('JIRA_BOARD_IDS must contain at least one board ID');
  }

  return {
    jira: {
      baseUrl: validateEnvVar('JIRA_BASE_URL').replace(/\/$/, ''),
      email: validateEnvVar('JIRA_EMAIL'),
      apiToken: validateEnvVar('JIRA_API_TOKEN'),
      boardIds,
      username: validateEnvVar('JIRA_USERNAME'),
    },
    polling: {
      intervalSeconds: parseInt(process.env.POLL_INTERVAL_SECONDS || '7200', 10),
    },
    claude: {
      awsRegion: validateEnvVar('AWS_REGION'),
      awsProfile: process.env.AWS_PROFILE,
      model: process.env.CLAUDE_MODEL || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      maxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS || '4096', 10),
      temperature: parseFloat(process.env.CLAUDE_TEMPERATURE || '0.3'),
    },
    bitbucket: {
      baseUrl: validateEnvVar('BITBUCKET_URL').replace(/\/$/, ''),
      username: validateEnvVar('BITBUCKET_USERNAME'),
      password: validateEnvVar('BITBUCKET_PASSWORD'),
      verifySsl: process.env.BITBUCKET_VERIFY_SSL !== 'false',
    },
    workflow: {
      tempDirBase: process.env.TEMP_DIR_BASE || './temp-repos',
      cloneTimeoutMs: parseInt(process.env.CLONE_TIMEOUT_MS || '300000', 10),
      maxConcurrentClones: parseInt(process.env.MAX_CONCURRENT_CLONES || '5', 10),
      cleanupAfterHours: parseInt(process.env.CLEANUP_AFTER_HOURS || '24', 10),
    },
    repositories: parseRepositories(process.env.REPOSITORIES || '[]'),
  };
}

export const config = loadConfig();
