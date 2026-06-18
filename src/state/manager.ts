import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { State } from './types.js';
import { logger } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_FILE_PATH = path.join(__dirname, '../../data/seen-tickets.json');
const MAX_SEEN_TICKETS = 1000;

export class StateManager {
  private state: State = {
    seenTicketKeys: [],
    lastChecked: new Date().toISOString(),
    workflows: {},
    repositories: [],
  };

  async loadState(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(STATE_FILE_PATH), { recursive: true });

      const data = await fs.readFile(STATE_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(data);

      if (parsed.seenTicketKeys && Array.isArray(parsed.seenTicketKeys)) {
        this.state = parsed;
        logger.info(`Loaded state: ${this.state.seenTicketKeys.length} seen tickets`);
      } else {
        throw new Error('Invalid state file structure');
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        logger.info('No existing state file found, starting fresh');
        await this.saveState();
      } else if (error instanceof SyntaxError) {
        logger.warn('Corrupted state file, resetting state');
        await this.backupAndResetState();
      } else {
        logger.error('Failed to load state:', error);
      }
    }
  }

  async saveState(): Promise<void> {
    try {
      this.pruneOldTickets();

      const data = JSON.stringify(this.state, null, 2);
      await fs.writeFile(STATE_FILE_PATH, data, 'utf-8');

      logger.debug('State saved successfully');
    } catch (error) {
      logger.error('Failed to save state:', error);
    }
  }

  markTicketAsSeen(ticketKey: string): void {
    if (!this.state.seenTicketKeys.includes(ticketKey)) {
      this.state.seenTicketKeys.push(ticketKey);
    }
  }

  hasSeenTicket(ticketKey: string): boolean {
    return this.state.seenTicketKeys.includes(ticketKey);
  }

  updateLastChecked(): void {
    this.state.lastChecked = new Date().toISOString();
  }

  getState(): State {
    return { ...this.state };
  }

  private pruneOldTickets(): void {
    if (this.state.seenTicketKeys.length > MAX_SEEN_TICKETS) {
      const excessCount = this.state.seenTicketKeys.length - MAX_SEEN_TICKETS;
      this.state.seenTicketKeys = this.state.seenTicketKeys.slice(excessCount);
      logger.info(`Pruned ${excessCount} old tickets from state`);
    }
  }

  private async backupAndResetState(): Promise<void> {
    try {
      const backupPath = `${STATE_FILE_PATH}.backup.${Date.now()}`;
      await fs.copyFile(STATE_FILE_PATH, backupPath);
      logger.info(`Backed up corrupted state to: ${backupPath}`);
    } catch (error) {
      logger.warn('Failed to backup corrupted state file');
    }

    this.state = {
      seenTicketKeys: [],
      lastChecked: new Date().toISOString(),
      workflows: {},
      repositories: [],
    };
    await this.saveState();
  }

  // Workflow management methods
  async saveWorkflow(workflow: any): Promise<void> {
    if (!this.state.workflows) {
      this.state.workflows = {};
    }
    this.state.workflows[workflow.ticketKey] = workflow;
    await this.saveState();
  }

  getWorkflow(ticketKey: string): any | undefined {
    return this.state.workflows?.[ticketKey];
  }

  async removeWorkflow(ticketKey: string): Promise<void> {
    if (this.state.workflows?.[ticketKey]) {
      delete this.state.workflows[ticketKey];
      await this.saveState();
    }
  }

  getAllWorkflows(): any[] {
    return Object.values(this.state.workflows || {});
  }
}

export const stateManager = new StateManager();
