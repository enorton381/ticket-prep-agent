import { simpleGit, SimpleGit } from 'simple-git';
import path from 'path';
import { bitbucketClient } from './client.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { EnhancedJiraTicket } from '../jira/types.js';
import { Repository, RepositorySelection, BranchPreparationResult, GitCommit } from './types.js';

/**
 * Maximum branch name length to ensure compatibility with Git and Bitbucket.
 * Following industry standard of 90 characters to prevent issues with some systems.
 */
const MAX_BRANCH_NAME_LENGTH = 90;

/**
 * Map Jira issue types to branch prefixes following team conventions.
 *
 * @param issueType - The Jira issue type (e.g., "Bug", "Story", "Epic")
 * @returns Branch prefix with trailing slash (e.g., "bugfix/") or empty string
 */
function getIssuePrefixFromType(issueType: string): string {
  const issueTypeLower = issueType.toLowerCase();

  if (issueTypeLower === 'bug') {
    return 'bugfix/';
  } else if (issueTypeLower === 'story' || issueTypeLower === 'new feature') {
    return 'feature/';
  } else if (issueTypeLower === 'epic') {
    return 'epic/';
  }
  // Internal Task, Refactor, and unknown types have no prefix
  return '';
}

/**
 * Slugify a summary string into a URL-safe format suitable for branch names.
 * Converts to lowercase and replaces all non-alphanumeric characters with hyphens.
 *
 * Pattern based on Vestmark's create-branch.sh implementation.
 *
 * @param summary - The ticket summary text
 * @returns Slugified string (lowercase, alphanumeric + hyphens only)
 *
 * @example
 * slugifySummary("Fix Login Error on Mobile")
 * // => "fix-login-error-on-mobile"
 */
function slugifySummary(summary: string): string {
  return summary
    .toLowerCase()                          // Convert to lowercase
    .replace(/[^a-z0-9]+/g, '-')            // Replace runs of non-alphanumeric with single hyphen
    .replace(/^-+/, '')                     // Trim leading hyphens
    .replace(/-+$/, '');                    // Trim trailing hyphens
}

/**
 * Generate a branch name following the team's naming convention.
 * Format: [prefix/]TICKET-123-slugified-summary_base-branch
 *
 * Implements intelligent truncation when name exceeds MAX_BRANCH_NAME_LENGTH:
 * - Progressively drops words from the END of the slug
 * - Preserves prefix, ticket key, and base branch suffix
 * - Ensures final name is <= 90 characters
 *
 * @param ticketKey - Jira ticket key (e.g., "PROJ-1234")
 * @param summary - Ticket summary (will be slugified)
 * @param parentBranch - Base branch name (e.g., "master", "release/2.5")
 * @param issueType - Jira issue type (determines prefix)
 * @returns Valid branch name <= 90 characters
 *
 * @example
 * generateBranchName("PROJ-123", "Fix critical login bug", "master", "Bug")
 * // => "bugfix/PROJ-123-fix-critical-login-bug_master"
 *
 * @example
 * // Long summary gets progressively trimmed
 * generateBranchName("PROJ-123", "Very long summary with many words that exceed limit", "release/2.5", "Story")
 * // => "feature/PROJ-123-very-long-summary-with-many_release/2.5" (truncated)
 */
export function generateBranchName(ticketKey: string, summary: string, parentBranch: string, issueType: string): string {
  // Get prefix based on issue type
  const prefix = getIssuePrefixFromType(issueType);

  // Slugify the summary (lowercase, alphanumeric + hyphens only)
  let slug = slugifySummary(summary);

  // Build the full branch name
  const assembleWithSlug = (currentSlug: string): string => {
    return `${prefix}${ticketKey}-${currentSlug}_${parentBranch}`;
  };

  let branchName = assembleWithSlug(slug);

  // Progressive trimming: drop trailing words from slug until we fit under 90 chars
  // This preserves the most important part (beginning of summary) while ensuring validity
  while (branchName.length > MAX_BRANCH_NAME_LENGTH && slug.includes('-')) {
    // Remove the last word (everything after the last hyphen)
    slug = slug.substring(0, slug.lastIndexOf('-'));
    branchName = assembleWithSlug(slug);
  }

  // Final validation: if still too long, throw error (shouldn't happen unless ticket key + prefix + parent is massive)
  if (branchName.length > MAX_BRANCH_NAME_LENGTH) {
    throw new Error(
      `Branch name still exceeds ${MAX_BRANCH_NAME_LENGTH} characters after trimming: ${branchName} (${branchName.length} chars). ` +
      `Ticket key, prefix, and parent branch may be too long.`
    );
  }

  return branchName;
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

/**
 * Pre-flight checks before creating a branch.
 * Verifies that the branch name doesn't already exist locally or remotely,
 * and that the base branch exists on the remote.
 *
 * @param git - SimpleGit instance
 * @param branchName - Name of the branch to create
 * @param baseBranch - Base branch to branch from
 * @throws Error if branch already exists or base branch is missing
 */
async function preflightChecks(git: SimpleGit, branchName: string, baseBranch: string): Promise<void> {
  // Check if branch already exists on remote
  try {
    const remoteRefs = await git.listRemote(['--heads', 'origin', branchName]);
    if (remoteRefs.trim().length > 0) {
      throw new Error(`Remote branch already exists: ${branchName}`);
    }
  } catch (error: any) {
    // If the error is about remote branch existing, re-throw it
    if (error.message?.includes('already exists')) {
      throw error;
    }
    // Other errors (like network issues) are non-fatal - log and continue
    logger.warn(`Could not check remote branch existence: ${error.message}`);
  }

  // Check if branch already exists locally
  const branches = await git.branchLocal();
  if (branches.all.includes(branchName)) {
    throw new Error(`Local branch already exists: ${branchName}`);
  }

  // Verify that the base branch exists on remote
  try {
    const baseRefs = await git.listRemote(['--heads', 'origin', baseBranch]);
    if (baseRefs.trim().length === 0) {
      throw new Error(`Base branch not found on remote: ${baseBranch}`);
    }
    logger.debug(`Base branch verified on remote: ${baseBranch}`);
  } catch (error: any) {
    if (error.message?.includes('not found')) {
      throw error;
    }
    // Network errors - log but don't fail (we'll find out when we try to create)
    logger.warn(`Could not verify base branch existence: ${error.message}`);
  }
}

/**
 * Create a new branch in the local repository.
 *
 * @param repoPath - Path to the local repository
 * @param branchName - Name of the branch to create
 * @throws Error if branch creation fails
 */
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

/**
 * Prepare a branch for a Jira ticket.
 * Complete workflow: fetch repo info, clone, generate name, run pre-flight checks,
 * create branch, and return metadata for CONTEXT.md generation.
 *
 * @param ticket - Enhanced Jira ticket with all required fields
 * @param repoSelection - Selected repository with optional base branch override
 * @param repoPath - Local path where repository will be cloned
 * @returns Branch preparation result with name, URL, and paths
 * @throws Error if any step fails (clone, name generation, pre-flight, branch creation)
 */
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

    // 3. Clone repository (shallow clone from base branch)
    await cloneRepository(repoWithBaseBranch, repoPath);

    // 4. Generate branch name with intelligent truncation
    // Format: [prefix/]TICKET-123-slugified-summary_base-branch
    // Automatically truncates slug to fit within 90 character limit
    const branchName = generateBranchName(ticket.key, ticket.summary, baseBranch, ticket.issueType);
    logger.info(`Generated branch name: ${branchName} (${branchName.length} chars, issue type: ${ticket.issueType})`);

    // 5. Run pre-flight checks before creating branch
    // Verifies: branch doesn't exist locally/remotely, base branch exists
    const git: SimpleGit = simpleGit(repoPath);
    await preflightChecks(git, branchName, baseBranch);
    logger.debug(`Pre-flight checks passed for ${branchName}`);

    // 6. Create new branch (from the currently checked out base branch)
    await createBranch(repoPath, branchName);

    // 7. Get commit history (for CONTEXT.md generation)
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
