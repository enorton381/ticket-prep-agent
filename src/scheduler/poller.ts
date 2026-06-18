import cron from 'node-cron';
import { fetchToDoTickets, fetchTicketDetails } from '../jira/operations.js';
import { stateManager } from '../state/manager.js';
import { automatedWorkflowManager } from '../workflow/automated-manager.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export async function pollJiraBoard(): Promise<void> {
  logger.info('Starting Jira "New" status tickets poll cycle');

  try {
    // Fetch all tickets in "New" status
    const tickets = await fetchToDoTickets();

    if (tickets.length === 0) {
      logger.info('No tickets in "New" status');
      stateManager.updateLastChecked();
      await stateManager.saveState();
      return;
    }

    logger.info(`Found ${tickets.length} ticket(s) in "New" status`);

    // Filter out tickets that have already been prepared or are currently being prepared
    const ticketsToPrepare = tickets.filter((ticket) => {
      if (automatedWorkflowManager.hasBeenPrepared(ticket.key)) {
        logger.debug(`Skipping ${ticket.key} - already prepared`);
        return false;
      }
      if (automatedWorkflowManager.isBeingPrepared(ticket.key)) {
        logger.debug(`Skipping ${ticket.key} - currently being prepared`);
        return false;
      }
      return true;
    });

    if (ticketsToPrepare.length === 0) {
      logger.info('All "New" tickets have already been prepared');
    } else {
      logger.info(`Preparing branches for ${ticketsToPrepare.length} ticket(s)`);

      for (const ticket of ticketsToPrepare) {
        logger.info(`Processing ticket: ${ticket.key} - ${ticket.summary}`);

        try {
          // Fetch full ticket details
          const enhancedTicket = await fetchTicketDetails(ticket.key);

          // Automatically prepare branch (no user interaction)
          await automatedWorkflowManager.prepareTicketBranch(enhancedTicket);
        } catch (error) {
          logger.error(`Failed to prepare branch for ${ticket.key}:`, error);
          // Continue with next ticket
        }
      }
    }

    stateManager.updateLastChecked();
    await stateManager.saveState();

    logger.info('Poll cycle completed successfully');
  } catch (error) {
    logger.error('Error during poll cycle:', error);
  }
}

export function startScheduler(): void {
  const intervalSeconds = config.polling.intervalSeconds;

  logger.info(`Starting scheduler: polling every ${intervalSeconds} second(s)`);

  // Convert seconds to cron expression
  // For intervals < 60 seconds, use */N seconds pattern
  // For >= 60 seconds, convert to minutes or hours
  let cronExpression: string;

  if (intervalSeconds < 60) {
    // Every N seconds
    cronExpression = `*/${intervalSeconds} * * * * *`;
  } else if (intervalSeconds < 3600) {
    // Every N minutes
    const minutes = Math.floor(intervalSeconds / 60);
    cronExpression = `0 */${minutes} * * * *`;
  } else {
    // Every N hours
    const hours = Math.floor(intervalSeconds / 3600);
    cronExpression = `0 0 */${hours} * * *`;
  }

  cron.schedule(cronExpression, async () => {
    logger.info('Scheduled poll triggered');
    await pollJiraBoard();
  });

  logger.info('Scheduler started. Running initial poll now...');
  pollJiraBoard();
}
