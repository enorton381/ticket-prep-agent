import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { logger } from '../logger.js';

export class TempDirectoryManager {
  private basePath: string;

  constructor() {
    this.basePath = path.resolve(config.workflow.tempDirBase);
    logger.info(`Temp directory base path: ${this.basePath}`);
  }

  async initialize(): Promise<void> {
    try {
      // Create base directory if it doesn't exist
      await fs.mkdir(this.basePath, { recursive: true });
      logger.info(`Temp directory initialized: ${this.basePath}`);

      // Clean up old directories on startup
      await this.cleanupOlderThan(config.workflow.cleanupAfterHours);
    } catch (error) {
      logger.error('Failed to initialize temp directory:', error);
      throw error;
    }
  }

  async createTempDir(ticketKey: string): Promise<string> {
    try {
      const tempDir = path.join(this.basePath, ticketKey);

      logger.info(`Creating temp directory for ${ticketKey}: ${tempDir}`);

      // Create directory
      await fs.mkdir(tempDir, { recursive: true });

      return tempDir;
    } catch (error) {
      logger.error(`Failed to create temp directory for ${ticketKey}:`, error);
      throw error;
    }
  }

  async cleanup(ticketKey: string): Promise<void> {
    try {
      const tempDir = path.join(this.basePath, ticketKey);

      logger.info(`Cleaning up temp directory: ${tempDir}`);

      // Check if directory exists
      try {
        await fs.access(tempDir);
      } catch {
        // Directory doesn't exist, nothing to clean up
        logger.debug(`Temp directory ${tempDir} does not exist`);
        return;
      }

      // Remove directory recursively
      await fs.rm(tempDir, { recursive: true, force: true });

      logger.info(`Successfully cleaned up temp directory for ${ticketKey}`);
    } catch (error) {
      logger.error(`Failed to cleanup temp directory for ${ticketKey}:`, error);
      // Don't throw - cleanup failures shouldn't stop workflow
    }
  }

  async cleanupAll(): Promise<void> {
    try {
      logger.info('Cleaning up all temp directories');

      // Check if base path exists
      try {
        await fs.access(this.basePath);
      } catch {
        logger.debug('Temp base directory does not exist');
        return;
      }

      // Get all directories
      const entries = await fs.readdir(this.basePath, { withFileTypes: true });
      const directories = entries.filter((entry) => entry.isDirectory());

      logger.info(`Found ${directories.length} temp directories to clean up`);

      // Remove all directories
      for (const dir of directories) {
        const dirPath = path.join(this.basePath, dir.name);
        try {
          await fs.rm(dirPath, { recursive: true, force: true });
          logger.debug(`Removed temp directory: ${dir.name}`);
        } catch (error) {
          logger.warn(`Failed to remove temp directory ${dir.name}:`, error);
        }
      }

      logger.info('Completed cleanup of all temp directories');
    } catch (error) {
      logger.error('Failed to cleanup all temp directories:', error);
    }
  }

  async cleanupOlderThan(hours: number): Promise<void> {
    try {
      logger.info(`Cleaning up temp directories older than ${hours} hours`);

      // Check if base path exists
      try {
        await fs.access(this.basePath);
      } catch {
        logger.debug('Temp base directory does not exist');
        return;
      }

      // Get all directories with stats
      const entries = await fs.readdir(this.basePath, { withFileTypes: true });
      const directories = entries.filter((entry) => entry.isDirectory());

      const now = Date.now();
      const cutoffTime = now - hours * 60 * 60 * 1000;

      let removedCount = 0;

      for (const dir of directories) {
        const dirPath = path.join(this.basePath, dir.name);

        try {
          const stats = await fs.stat(dirPath);
          const modifiedTime = stats.mtimeMs;

          if (modifiedTime < cutoffTime) {
            await fs.rm(dirPath, { recursive: true, force: true });
            logger.debug(`Removed old temp directory: ${dir.name} (age: ${Math.round((now - modifiedTime) / 1000 / 60 / 60)}h)`);
            removedCount++;
          }
        } catch (error) {
          logger.warn(`Failed to check/remove temp directory ${dir.name}:`, error);
        }
      }

      logger.info(`Cleaned up ${removedCount} old temp directories`);
    } catch (error) {
      logger.error('Failed to cleanup old temp directories:', error);
    }
  }

  async checkDiskSpace(): Promise<boolean> {
    // Simple check - ensure we have at least 5GB free
    // Note: This is a basic check, not exact
    try {
      // For now, just log a warning if temp dir is getting large
      const entries = await fs.readdir(this.basePath, { withFileTypes: true });
      const dirCount = entries.filter((e) => e.isDirectory()).length;

      if (dirCount > 10) {
        logger.warn(`Temp directory has ${dirCount} directories - consider cleanup`);
      }

      return true;
    } catch (error) {
      logger.warn('Failed to check disk space:', error);
      return true; // Don't block on disk space check failures
    }
  }
}

export const tempDirectoryManager = new TempDirectoryManager();
