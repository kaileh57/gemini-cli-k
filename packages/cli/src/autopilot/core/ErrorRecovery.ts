/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AutopilotDatabase } from '../storage/Database.js';
import { SafetyController } from './SafetyController.js';
import { ActivityMetadata } from '../types.js';

export interface RecoveryContext {
  attemptId?: number;
  issueId?: number;
  repositoryId?: number;
  workspacePath?: string;
  branchName?: string;
  operation: string;
  startTime: Date;
}

export class ErrorRecovery {
  private database: AutopilotDatabase;
  private safetyController: SafetyController;
  private activeContexts: Map<string, RecoveryContext>;

  constructor(database: AutopilotDatabase, safetyController: SafetyController) {
    this.database = database;
    this.safetyController = safetyController;
    this.activeContexts = new Map();
  }

  /**
   * Register a context for potential recovery
   */
  registerContext(contextId: string, context: RecoveryContext): void {
    this.activeContexts.set(contextId, context);

    this.database.logActivity(
      'info',
      'error_recovery',
      `Registered recovery context for ${context.operation}`,
      { contextId, operation: context.operation },
    );
  }

  /**
   * Unregister a successfully completed context
   */
  unregisterContext(contextId: string): void {
    const context = this.activeContexts.get(contextId);
    if (context) {
      this.activeContexts.delete(contextId);

      const duration = Date.now() - context.startTime.getTime();
      this.database.logActivity(
        'info',
        'error_recovery',
        `Unregistered recovery context for ${context.operation} (completed in ${duration}ms)`,
        { contextId, operation: context.operation, duration },
      );
    }
  }

  /**
   * Handle an error with comprehensive recovery
   */
  async handleError(
    contextId: string,
    error: Error,
    additionalInfo?: ActivityMetadata,
  ): Promise<void> {
    const context = this.activeContexts.get(contextId);
    if (!context) {
      this.database.logActivity(
        'warning',
        'error_recovery',
        `No recovery context found for ${contextId}`,
        { contextId, error: error.message },
      );
      return;
    }

    this.database.logActivity(
      'error',
      'error_recovery',
      `Handling error in ${context.operation}: ${error.message}`,
      {
        contextId,
        operation: context.operation,
        error: error.message,
        additionalInfo,
      },
    );

    try {
      // Perform specific recovery based on operation type
      await this.performRecovery(context, error);

      // Clean up the context
      this.unregisterContext(contextId);
    } catch (recoveryError) {
      this.database.logActivity(
        'error',
        'error_recovery',
        `Recovery failed for ${context.operation}: ${(recoveryError as Error).message}`,
        {
          contextId,
          originalError: error.message,
          recoveryError: (recoveryError as Error).message,
        },
      );

      // Force cleanup on recovery failure
      await this.forceCleanup(context);
      this.unregisterContext(contextId);
    }
  }

  /**
   * Perform recovery based on operation type
   */
  private async performRecovery(
    context: RecoveryContext,
    error: Error,
  ): Promise<void> {
    switch (context.operation) {
      case 'issue_processing':
        await this.recoverIssueProcessing(context, error);
        break;

      case 'workspace_setup':
        await this.recoverWorkspaceSetup(context, error);
        break;

      case 'code_generation':
        await this.recoverCodeGeneration(context, error);
        break;

      case 'git_operations':
        await this.recoverGitOperations(context, error);
        break;

      case 'test_execution':
        await this.recoverTestExecution(context, error);
        break;

      default:
        await this.genericRecovery(context, error);
        break;
    }
  }

  private async recoverIssueProcessing(
    context: RecoveryContext,
    error: Error,
  ): Promise<void> {
    this.database.logActivity(
      'info',
      'error_recovery',
      'Recovering from issue processing error',
    );

    // Mark attempt as failed if it exists
    if (context.attemptId) {
      this.database.completeAttempt(context.attemptId, 'failure', {
        success: false,
        error: error.message,
      });
    }

    // Clean up workspace if it exists
    if (context.workspacePath) {
      await this.safetyController.cleanupWorkspace(context.workspacePath);
    }

    // Update queue item status if applicable
    if (context.issueId) {
      const queueItem = this.database
        .getQueue()
        .find((q) => q.issueId === context.issueId);
      if (queueItem) {
        this.database.updateQueueItemStatus(
          queueItem.id,
          'failed',
          error.message,
        );
      }
    }
  }

  private async recoverWorkspaceSetup(
    context: RecoveryContext,
    _error: Error,
  ): Promise<void> {
    this.database.logActivity(
      'info',
      'error_recovery',
      'Recovering from workspace setup error',
    );

    // Clean up any partially created workspace
    if (context.workspacePath) {
      await this.safetyController.cleanupWorkspace(context.workspacePath);
    }
  }

  private async recoverCodeGeneration(
    context: RecoveryContext,
    error: Error,
  ): Promise<void> {
    this.database.logActivity(
      'info',
      'error_recovery',
      'Recovering from code generation error',
    );

    // Log the failure details for analysis
    this.database.logActivity(
      'error',
      'code_generation',
      `Code generation failed: ${error.message}`,
      { issueId: context.issueId, repositoryId: context.repositoryId },
    );

    // Clean up any temporary files or partial changes
    if (context.workspacePath) {
      await this.resetWorkspaceToCleanState(context.workspacePath);
    }
  }

  private async recoverGitOperations(
    context: RecoveryContext,
    _error: Error,
  ): Promise<void> {
    this.database.logActivity(
      'info',
      'error_recovery',
      'Recovering from git operations error',
    );

    if (context.workspacePath) {
      try {
        // Reset to main branch and clean up
        await this.safetyController.executeGitCommand(
          'git checkout main',
          context.workspacePath,
        );

        // Delete the problematic branch if it exists
        if (context.branchName) {
          await this.safetyController.executeGitCommand(
            `git branch -D ${context.branchName}`,
            context.workspacePath,
          );
        }

        // Reset any uncommitted changes
        await this.safetyController.executeGitCommand(
          'git reset --hard HEAD',
          context.workspacePath,
        );
        await this.safetyController.executeGitCommand(
          'git clean -fd',
          context.workspacePath,
        );
      } catch (gitError) {
        this.database.logActivity(
          'warning',
          'error_recovery',
          `Git cleanup failed, falling back to workspace deletion: ${(gitError as Error).message}`,
        );

        await this.safetyController.cleanupWorkspace(context.workspacePath);
      }
    }
  }

  private async recoverTestExecution(
    context: RecoveryContext,
    error: Error,
  ): Promise<void> {
    this.database.logActivity(
      'info',
      'error_recovery',
      'Recovering from test execution error',
    );

    // Log test failure details
    this.database.logActivity(
      'warning',
      'test_execution',
      `Test execution failed: ${error.message}`,
      { issueId: context.issueId, workspacePath: context.workspacePath },
    );

    // Reset workspace to clean state for potential retry
    if (context.workspacePath) {
      await this.resetWorkspaceToCleanState(context.workspacePath);
    }
  }

  private async genericRecovery(
    context: RecoveryContext,
    error: Error,
  ): Promise<void> {
    this.database.logActivity(
      'info',
      'error_recovery',
      `Performing generic recovery for ${context.operation}`,
    );

    // Generic cleanup - workspace and database state
    if (context.workspacePath) {
      await this.safetyController.cleanupWorkspace(context.workspacePath);
    }

    if (context.attemptId) {
      this.database.completeAttempt(context.attemptId, 'failure', {
        success: false,
        error: error.message,
      });
    }
  }

  private async resetWorkspaceToCleanState(
    workspacePath: string,
  ): Promise<void> {
    try {
      // Reset git state to clean
      await this.safetyController.executeGitCommand(
        'git reset --hard HEAD',
        workspacePath,
      );
      await this.safetyController.executeGitCommand(
        'git clean -fd',
        workspacePath,
      );

      this.database.logActivity(
        'info',
        'error_recovery',
        'Reset workspace to clean state',
      );
    } catch (error) {
      this.database.logActivity(
        'warning',
        'error_recovery',
        `Failed to reset workspace, will clean up entirely: ${(error as Error).message}`,
      );

      await this.safetyController.cleanupWorkspace(workspacePath);
    }
  }

  private async forceCleanup(context: RecoveryContext): Promise<void> {
    this.database.logActivity(
      'warning',
      'error_recovery',
      'Performing force cleanup after recovery failure',
    );

    try {
      // Force workspace cleanup
      if (context.workspacePath) {
        await this.safetyController.cleanupWorkspace(context.workspacePath);
      }

      // Mark attempt as failed
      if (context.attemptId) {
        this.database.completeAttempt(context.attemptId, 'failure', {
          success: false,
          error: 'Recovery failed - force cleanup performed',
        });
      }

      // Update queue status
      if (context.issueId) {
        const queueItem = this.database
          .getQueue()
          .find((q) => q.issueId === context.issueId);
        if (queueItem) {
          this.database.updateQueueItemStatus(
            queueItem.id,
            'failed',
            'Recovery failed',
          );
        }
      }
    } catch (cleanupError) {
      this.database.logActivity(
        'error',
        'error_recovery',
        `Force cleanup failed: ${(cleanupError as Error).message}`,
        { context, cleanupError: (cleanupError as Error).message },
      );
    }
  }

  /**
   * Clean up all active contexts (called on service shutdown)
   */
  async cleanupAllContexts(): Promise<void> {
    this.database.logActivity(
      'info',
      'error_recovery',
      `Cleaning up ${this.activeContexts.size} active contexts on shutdown`,
    );

    const cleanupPromises = Array.from(this.activeContexts.entries()).map(
      async ([contextId, context]) => {
        try {
          await this.forceCleanup(context);
          this.unregisterContext(contextId);
        } catch (error) {
          this.database.logActivity(
            'error',
            'error_recovery',
            `Failed to cleanup context ${contextId}: ${(error as Error).message}`,
          );
        }
      },
    );

    await Promise.allSettled(cleanupPromises);
    this.activeContexts.clear();
  }

  /**
   * Get recovery statistics
   */
  getRecoveryStats(): { activeContexts: number; operations: string[] } {
    return {
      activeContexts: this.activeContexts.size,
      operations: Array.from(this.activeContexts.values()).map(
        (c) => c.operation,
      ),
    };
  }
}
