import { simpleGit, SimpleGit } from 'simple-git';
import path from 'path';
import { bitbucketClient } from './client.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { EnhancedJiraTicket } from '../jira/types.js';
import { Repository, RepositorySelection, BranchPreparationResult, GitCommit } from './types.js';

function getIssuePrefixFromType(issueType: string): string {
  // Map Jira issue types to branch prefixes
  const issueTypeLower = issueType.toLowerCase();

  if (issueTypeLower === 'bug') {
    return 'bugfix/';
  } else if (issueTypeLower === 'story' || issueTypeLower === 'new feature') {
    return 'feature/';
  } else if (issueTypeLower === 'epic') {
    return 'epic/';
  } // else if (issueTypeLower === 'story') { // unsure whether story should be feature/ or no prefix
    // return '';
  // }
  // Internal Task, Refactor, and unknown types have no prefix
  return '';
}

export function generateBranchName(ticketKey: string, summary: string, parentBranch: string, issueType: string): string {
  // Use the ticket title as-is, just replace spaces and slashes with hyphens
  const ticketTitle = summary
    .replace(/\s+/g, '-') // Spaces to hyphens
    .replace(/\//g, '-')  // Slashes to hyphens
    .replace(/-+/g, '-'); // Multiple hyphens to single

  // Get prefix based on issue type
  const prefix = getIssuePrefixFromType(issueType);

  // Format: prefix/TICKET-123-{TICKET TITLE}_parent-branch
  return `${prefix}${ticketKey}-${ticketTitle}_${parentBranch}`;
}

export async function cloneRepository(
  repository: Repository,
  targetDir: string
): Promise<void> {
  try {
    logger.info(`Cloning repository ${repository.project}/${repository.repo} to ${targetDir}`);

    // Set timeout for clone operation
    const timeoutMs = config.workflow.cloneTimeoutMs;

    const git: SimpleGit = simpleGit({
      timeout: {
        block: timeoutMs,
      },
    });

    // Clone with credentials embedded in URL
    await git.clone(repository.cloneUrl, targetDir, {
      '--depth': 1, // Shallow clone for speed
      '--single-branch': null,
      '--branch': repository.defaultBranch,
    });

    logger.info(`Successfully cloned repository to ${targetDir}`);
  } catch (error: any) {
    logger.error(`Failed to clone repository:`, error);

    // Check for specific error types
    if (error.message?.includes('Authentication failed')) {
      throw new Error('Bitbucket authentication failed. Check your credentials.');
    } else if (error.message?.includes('timeout')) {
      throw new Error(`Clone operation timed out after ${config.workflow.cloneTimeoutMs}ms`);
    }

    throw new Error(`Failed to clone repository: ${error.message}`);
  }
}

export async function createBranch(
  repoPath: string,
  branchName: string
): Promise<void> {
  try {
    logger.info(`Creating branch ${branchName} in ${repoPath}`);

    const git: SimpleGit = simpleGit(repoPath);

    // Create and checkout new branch
    await git.checkoutLocalBranch(branchName);

    logger.info(`Successfully created branch ${branchName}`);
  } catch (error) {
    logger.error(`Failed to create branch ${branchName}:`, error);
    throw new Error(`Failed to create branch: ${error}`);
  }
}

export async function commitChanges(
  repoPath: string,
  message: string
): Promise<string> {
  try {
    logger.info(`Committing changes in ${repoPath}`);

    const git: SimpleGit = simpleGit(repoPath);

    // Stage all changes
    await git.add('.');

    // Commit with message
    const commitResult = await git.commit(message);

    const commitSha = commitResult.commit;
    logger.info(`Successfully committed changes: ${commitSha}`);

    return commitSha;
  } catch (error) {
    logger.error('Failed to commit changes:', error);
    throw new Error(`Failed to commit changes: ${error}`);
  }
}

export async function pushBranch(
  repoPath: string,
  branchName: string
): Promise<void> {
  try {
    logger.info(`Pushing branch ${branchName} to remote`);

    const git: SimpleGit = simpleGit(repoPath);

    // Push branch to origin with upstream tracking
    await git.push('origin', branchName, ['--set-upstream']);

    logger.info(`Successfully pushed branch ${branchName}`);
  } catch (error: any) {
    logger.error(`Failed to push branch ${branchName}:`, error);

    // Check for specific push errors
    if (error.message?.includes('rejected')) {
      throw new Error('Push rejected - branch may already exist or have conflicts');
    } else if (error.message?.includes('Authentication failed')) {
      throw new Error('Authentication failed during push. Check your credentials.');
    }

    throw new Error(`Failed to push branch: ${error.message}`);
  }
}

export async function getRecentCommits(
  repoPath: string,
  limit: number = 100
): Promise<GitCommit[]> {
  try {
    logger.info(`Fetching last ${limit} commits from ${repoPath}`);

    const git: SimpleGit = simpleGit(repoPath);

    const log = await git.log({ maxCount: limit });

    const commits: GitCommit[] = log.all.map((commit) => ({
      sha: commit.hash,
      message: commit.message,
      author: commit.author_name,
      date: commit.date,
    }));

    logger.info(`Fetched ${commits.length} commits`);
    return commits;
  } catch (error) {
    logger.error('Failed to get commit history:', error);
    return [];
  }
}

export async function prepareBranch(
  ticket: EnhancedJiraTicket,
  repoSelection: RepositorySelection,
  repoPath: string
): Promise<BranchPreparationResult> {
  try {
    logger.info(`Preparing branch for ticket ${ticket.key} in repository ${repoSelection.project}/${repoSelection.repo}`);

    // 1. Get repository details from Bitbucket
    const repository = await bitbucketClient.getRepository(repoSelection.project, repoSelection.repo);

    // 2. Determine which branch to clone and branch from
    const baseBranch = repoSelection.baseBranch || repository.defaultBranch;
    logger.info(`Using base branch: ${baseBranch}`);

    // Override the repository's default branch with the selected base branch
    const repoWithBaseBranch = { ...repository, defaultBranch: baseBranch };

    // 3. Clone repository
    await cloneRepository(repoWithBaseBranch, repoPath);

    // 4. Generate branch name (includes prefix based on issue type and parent branch in the name)
    const branchName = generateBranchName(ticket.key, ticket.summary, baseBranch, ticket.issueType);
    logger.info(`Generated branch name: ${branchName} (issue type: ${ticket.issueType})`);

    // 5. Create new branch (from the currently checked out base branch)
    await createBranch(repoPath, branchName);

    // 6. Get commit history (for CONTEXT.md generation)
    const recentCommits = await getRecentCommits(repoPath, 100);

    // Return result with placeholder CONTEXT.md path and commit SHA
    // (CONTEXT.md generation and commit will happen in the workflow)
    const branchUrl = bitbucketClient.getBranchUrl(repoSelection.project, repoSelection.repo, branchName);

    return {
      branchName,
      branchUrl,
      contextMdPath: path.join(repoPath, 'CONTEXT.md'),
      commitSha: '', // Will be filled after commit
    };
  } catch (error) {
    logger.error(`Failed to prepare branch for ${ticket.key}:`, error);
    throw error;
  }
}
