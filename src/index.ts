import { config } from './config.js';
import { jiraClient } from './jira/client.js';
import { bitbucketClient } from './bitbucket/client.js';
import { stateManager } from './state/manager.js';
import { tempDirectoryManager } from './temp/manager.js';
import { automatedWorkflowManager } from './workflow/automated-manager.js';
import { startScheduler } from './scheduler/poller.js';
import { logger } from './logger.js';

async function main() {
  logger.info('=== Jira "To Do" Branch Preparation Agent Starting ===');

  try {
    logger.info('Loading configuration...');
    logger.info(`Jira Base URL: ${config.jira.baseUrl}`);
    logger.info(`Bitbucket Base URL: ${config.bitbucket.baseUrl}`);
    logger.info(`Board IDs: ${config.jira.boardIds.join(', ')}`);
    logger.info(`Poll Interval: ${config.polling.intervalSeconds} seconds`);
    logger.info(`Claude Model: ${config.claude.model}`);

    logger.info('Initializing Jira client...');
    await jiraClient.initialize();

    logger.info('Testing Bitbucket connection...');
    const bitbucketConnected = await bitbucketClient.testConnection();
    if (!bitbucketConnected) {
      throw new Error('Bitbucket connection failed. Check your credentials.');
    }

    logger.info('Initializing temp directory manager...');
    await tempDirectoryManager.initialize();

    logger.info('Loading state...');
    await stateManager.loadState();

    logger.info('Cleaning up stale workflows...');
    await automatedWorkflowManager.cleanupStaleWorkflows();

    logger.info('Starting scheduler...');
    startScheduler();

    logger.info('=== Agent is now running ===');
    logger.info('Press Ctrl+C to stop');

    setupGracefulShutdown();
  } catch (error) {
    logger.error('Failed to start agent:', error);
    process.exit(1);
  }
}

function setupGracefulShutdown() {
  const shutdownHandler = async (signal: string) => {
    logger.info(`\nReceived ${signal}, shutting down gracefully...`);

    try {
      await stateManager.saveState();
      logger.info('State saved successfully');
    } catch (error) {
      logger.error('Failed to save state during shutdown:', error);
    }

    logger.info('Goodbye!');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdownHandler('SIGINT'));
  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
}

main();
