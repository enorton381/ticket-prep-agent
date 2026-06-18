import { EnhancedJiraTicket } from '../jira/types.js';
import { WorkflowState, WorkflowTicket } from './state-machine.js';
import { BranchPreparationWorkflow } from './branch-preparation.js';
import { RepositorySelection } from '../bitbucket/types.js';
import { claudeClient } from '../claude/client.js';
import { addCommentToTicket } from '../jira/operations.js';
import { stateManager } from '../state/manager.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { bitbucketClient } from '../bitbucket/client.js';

export class AutomatedWorkflowManager {
  /**
   * Automatically prepares a branch for a ticket without user interaction.
   * First evaluates with Claude to determine if branch preparation is needed.
   * Uses component-to-repository mapping to determine the target repository.
   */
  async prepareTicketBranch(ticket: EnhancedJiraTicket): Promise<void> {
    const workflow: WorkflowTicket = {
      ticketKey: ticket.key,
      state: WorkflowState.DETECTED,
      startedAt: new Date().toISOString(),
    };

    try {
      await stateManager.saveWorkflow(workflow);
      logger.info(`Started automated workflow for ${ticket.key}`);

      // Stage 1: Evaluate with Claude to determine if branch preparation is needed
      workflow.state = WorkflowState.EVALUATING;
      await stateManager.saveWorkflow(workflow);

      logger.info(`Evaluating ticket ${ticket.key} with Claude to determine if branch preparation is needed`);
      const evaluation = await claudeClient.evaluateTicket(ticket);
      workflow.evaluation = evaluation;
      await stateManager.saveWorkflow(workflow);

      logger.info(`Evaluation result for ${ticket.key}: shouldPrepare=${evaluation.shouldPrepare}, workType=${evaluation.workType}, confidence=${evaluation.confidence}`);

      // If Claude determines this doesn't need a branch, skip preparation
      if (!evaluation.shouldPrepare) {
        workflow.state = WorkflowState.SKIPPED;
        workflow.completedAt = new Date().toISOString();
        await stateManager.saveWorkflow(workflow);

        logger.info(`Skipping branch preparation for ${ticket.key} - Work type: ${evaluation.workType}`);
        logger.info(`Reason: ${evaluation.reasoning}`);

        // Add a comment to Jira explaining why no branch was prepared
        try {
          const comment = `Automated branch preparation was skipped for this ticket.

This ticket appears to be ${evaluation.workType} work that doesn't require code changes. If this assessment is incorrect, please manually create a branch.`;

          await addCommentToTicket(ticket.key, comment);
        } catch (error) {
          logger.warn(`Failed to add Jira comment for skipped ticket ${ticket.key}:`, error);
        }

        return;
      }

      logger.info(`Proceeding with branch preparation for ${ticket.key} - Work type: ${evaluation.workType}`)

      // Stage 2: Claude selects the appropriate repository
      workflow.state = WorkflowState.AWAITING_REPO_INPUT;
      await stateManager.saveWorkflow(workflow);

      const repositories = config.repositories;

      if (repositories.length === 0) {
        const error = `No repositories configured in REPOSITORIES environment variable`;
        logger.error(error);
        workflow.state = WorkflowState.FAILED;
        workflow.error = error;
        workflow.completedAt = new Date().toISOString();
        await stateManager.saveWorkflow(workflow);
        return;
      }

      let repository: RepositorySelection;

      if (repositories.length === 1) {
        // Only one repository configured, use it
        logger.info(`Only one repository configured, using: ${repositories[0].project}/${repositories[0].repo}`);
        repository = {
          project: repositories[0].project,
          repo: repositories[0].repo,
        };
      } else {
        // Multiple repositories - use Claude to select the best one
        logger.info(`Selecting repository from ${repositories.length} options using Claude`);

        let selection;
        try {
          selection = await claudeClient.selectRepository(ticket, repositories);
        } catch (error: any) {
          // Claude couldn't select a repository - skip this ticket
          workflow.state = WorkflowState.FAILED;
          workflow.error = `Unable to determine appropriate repository: ${error.message}`;
          workflow.completedAt = new Date().toISOString();
          await stateManager.saveWorkflow(workflow);

          logger.error(`Could not select repository for ${ticket.key}: ${error.message}`);

          // Add a comment to Jira explaining the issue
          try {
            const comment = `Automated branch preparation was skipped for this ticket. Claude Could not determine which repository this work should be done in.`;

            await addCommentToTicket(ticket.key, comment);
          } catch (commentError) {
            logger.warn(`Failed to add Jira comment for repository selection failure on ${ticket.key}:`, commentError);
          }

          return;
        }

        const selectedRepo = repositories[selection.repositoryIndex];
        repository = {
          project: selectedRepo.project,
          repo: selectedRepo.repo,
        };

        logger.info(`Claude selected repository: ${repository.project}/${repository.repo}`);
        logger.info(`Selection reasoning: ${selection.reasoning}`);
        logger.info(`Selection confidence: ${selection.confidence}`);
      }

      // Stage 3: Claude selects the appropriate base branch
      logger.info(`Selecting base branch for ticket ${ticket.key}`);
      logger.debug(`Repository selection: project=${repository.project}, repo=${repository.repo}`);

      try {
        // Get available branches from Bitbucket
        const allBranches = await bitbucketClient.listBranches(repository.project, repository.repo);
        const defaultBranch = await bitbucketClient.getDefaultBranch(repository.project, repository.repo);

        // Filter branches to only include master, release/*, and epic/* branches
        // Exclude feature/*, bugfix/*, hotfix/*, dev, and other development branches
        const allowedBranches = allBranches.filter(branch => {
          const branchLower = branch.toLowerCase();
          return (
            branchLower === 'master' ||
            branchLower === 'main' ||
            branch.startsWith('release/') ||
            branch.startsWith('epic/')
          );
        });

        logger.info(`Filtered ${allBranches.length} branches to ${allowedBranches.length} allowed branches (master, release/*, epic/*)`);

        if (allowedBranches.length === 0) {
          // Fallback if no allowed branches found
          logger.warn(`No allowed branches found for ${repository.project}/${repository.repo}, using default branch: ${defaultBranch}`);
          repository.baseBranch = defaultBranch;
        } else {
          // Use Claude to select the best base branch from allowed branches
          const branchSelection = await claudeClient.selectBaseBranch(ticket, allowedBranches, defaultBranch);
          repository.baseBranch = branchSelection.selectedBranch;

          logger.info(`Claude selected base branch: ${repository.baseBranch}`);
          logger.info(`Base branch reasoning: ${branchSelection.reasoning}`);
          logger.info(`Base branch confidence: ${branchSelection.confidence}`);
        }
      } catch (error) {
        // If branch selection fails entirely, skip setting baseBranch (will use repository default)
        logger.warn(`Failed to select base branch for ${repository.project}/${repository.repo}:`, error);
        logger.info(`Will use repository's default branch during clone`);
      }

      workflow.repository = repository;
      await stateManager.saveWorkflow(workflow);

      // Execute branch preparation
      workflow.state = WorkflowState.PREPARING_BRANCH;
      await stateManager.saveWorkflow(workflow);

      logger.info(`Starting branch preparation for ${ticket.key} in ${repository.project}/${repository.repo} from ${repository.baseBranch}`);

      const preparationWorkflow = new BranchPreparationWorkflow(ticket, repository);
      const result = await preparationWorkflow.execute();

      workflow.result = result;
      workflow.state = WorkflowState.COMPLETED;
      workflow.completedAt = new Date().toISOString();
      await stateManager.saveWorkflow(workflow);

      logger.info(`✓ Automated workflow completed successfully for ${ticket.key}`);
      logger.info(`  Branch: ${result.branchName}`);
      logger.info(`  URL: ${result.branchUrl}`);
    } catch (error: any) {
      logger.error(`Automated workflow failed for ${ticket.key}:`, error);

      workflow.state = WorkflowState.FAILED;
      workflow.error = error.message;
      workflow.completedAt = new Date().toISOString();
      await stateManager.saveWorkflow(workflow);
    }
  }


  /**
   * Checks if a ticket has already been prepared (has a completed workflow).
   */
  hasBeenPrepared(ticketKey: string): boolean {
    const workflow = stateManager.getWorkflow(ticketKey);
    return workflow?.state === WorkflowState.COMPLETED;
  }

  /**
   * Checks if a ticket is currently being prepared.
   */
  isBeingPrepared(ticketKey: string): boolean {
    const workflow = stateManager.getWorkflow(ticketKey);
    return workflow?.state === WorkflowState.PREPARING_BRANCH;
  }

  async cleanupStaleWorkflows(): Promise<void> {
    try {
      const workflows = stateManager.getAllWorkflows();
      const now = Date.now();
      const cutoffTime = now - 24 * 60 * 60 * 1000; // 24 hours

      let cleanedCount = 0;

      for (const workflow of workflows) {
        const startedAt = new Date(workflow.startedAt).getTime();

        // Clean up workflows that are:
        // 1. Completed/Failed/Skipped and older than 7 days
        // 2. In progress but older than 24 hours (probably stale)
        if (
          (workflow.state === WorkflowState.COMPLETED ||
            workflow.state === WorkflowState.FAILED ||
            workflow.state === WorkflowState.SKIPPED) &&
          startedAt < now - 7 * 24 * 60 * 60 * 1000
        ) {
          await stateManager.removeWorkflow(workflow.ticketKey);
          cleanedCount++;
        } else if (
          workflow.state !== WorkflowState.COMPLETED &&
          workflow.state !== WorkflowState.FAILED &&
          workflow.state !== WorkflowState.SKIPPED &&
          startedAt < cutoffTime
        ) {
          // Mark as failed
          workflow.state = WorkflowState.FAILED;
          workflow.error = 'Workflow timed out (>24h)';
          workflow.completedAt = new Date().toISOString();
          await stateManager.saveWorkflow(workflow);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.info(`Cleaned up ${cleanedCount} stale workflows`);
      }
    } catch (error) {
      logger.error('Failed to cleanup stale workflows:', error);
    }
  }

  getWorkflowStatus(ticketKey: string): WorkflowTicket | undefined {
    return stateManager.getWorkflow(ticketKey);
  }
}

export const automatedWorkflowManager = new AutomatedWorkflowManager();
