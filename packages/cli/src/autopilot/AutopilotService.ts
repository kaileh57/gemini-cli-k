/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config, ShellTool } from '@google/gemini-cli-core';
import { LoadedSettings } from '../config/settings.js';
import { AutopilotDatabase } from './storage/Database.js';
import { SafetyController } from './core/SafetyController.js';
import { ErrorRecovery } from './core/ErrorRecovery.js';
import { GitHubClient } from './github/GitHubClient.js';
import { IssueClassifier } from './ai/IssueClassifier.js';
import { GeminiIntegration } from './ai/GeminiIntegration.js';
import {
  AutopilotSettings,
  AutopilotStatus,
  GitHubIssue,
  QueueItem,
  Repository,
} from './types.js';
import {
  getDefaultAutopilotSettings,
  mergeAutopilotSettings,
} from './config.js';

export class AutopilotService {
  private static instance: AutopilotService | null = null;
  private config: Config;
  private database: AutopilotDatabase;
  private safetyController: SafetyController;
  private errorRecovery: ErrorRecovery;
  private gitHubClient: GitHubClient;
  private issueClassifier: IssueClassifier;
  private geminiIntegration: GeminiIntegration;
  private shellTool: ShellTool;
  private settings: AutopilotSettings;
  private isRunning: boolean = false;
  private mainLoopTimeout: NodeJS.Timeout | null = null;
  private currentActivity:
    | { description: string; startTime: string }
    | undefined;
  private consecutiveErrors: number = 0;
  private lastErrorTime: number = 0;

  private constructor(config: Config, loadedSettings: LoadedSettings) {
    this.config = config;

    // Merge default settings with user settings
    const defaultSettings = getDefaultAutopilotSettings();
    const userSettings = loadedSettings.merged.autopilot || {};
    this.settings = mergeAutopilotSettings(defaultSettings, userSettings);

    // Initialize components
    this.database = new AutopilotDatabase(this.settings.databasePath);
    this.safetyController = new SafetyController(
      config,
      this.database,
      this.settings,
    );
    this.errorRecovery = new ErrorRecovery(
      this.database,
      this.safetyController,
    );
    this.gitHubClient = new GitHubClient(config, this.database);
    this.issueClassifier = new IssueClassifier(
      config,
      this.database,
      this.settings,
    );
    this.geminiIntegration = new GeminiIntegration(config, this.database);
    this.shellTool = new ShellTool(config);
  }

  static getInstance(
    config?: Config,
    loadedSettings?: LoadedSettings,
  ): AutopilotService {
    if (!AutopilotService.instance) {
      if (!config || !loadedSettings) {
        throw new Error(
          'Config and LoadedSettings required for first initialization',
        );
      }
      AutopilotService.instance = new AutopilotService(config, loadedSettings);
    }
    return AutopilotService.instance;
  }

  static reset(): void {
    AutopilotService.instance = null;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Autopilot is already running');
    }

    if (!this.settings.enabled) {
      throw new Error('Autopilot is disabled in settings');
    }

    await this.database.initialize();
    await this.geminiIntegration.initialize();
    await this.safetyController.validateSetup();

    this.isRunning = true;
    this.database.logActivity('info', 'service', 'Autopilot service started');

    // Start the main processing loop
    this.runMainLoop();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.mainLoopTimeout) {
      clearTimeout(this.mainLoopTimeout);
      this.mainLoopTimeout = null;
    }

    // Clean up any active recovery contexts
    await this.errorRecovery.cleanupAllContexts();

    this.currentActivity = undefined;
    this.database.logActivity('info', 'service', 'Autopilot service stopped');
  }

  isServiceRunning(): boolean {
    return this.isRunning;
  }

  async getStatus(): Promise<AutopilotStatus> {
    const today = new Date();
    const dailyStats = this.database.getDailyStats(today);
    const queueStats = this.database.getQueueStats();

    const nextScan = this.isRunning
      ? new Date(
          Date.now() + this.settings.scanning.intervalMinutes * 60 * 1000,
        ).toISOString()
      : undefined;

    return {
      isRunning: this.isRunning,
      nextScan,
      dailyStats: {
        attempts: dailyStats.totalAttempts,
        prs: dailyStats.totalPrs,
        cost: dailyStats.totalCostUsd,
      },
      limits: this.settings.dailyLimits,
      queueStats,
      currentActivity: this.currentActivity,
    };
  }

  async getRepositories(): Promise<Repository[]> {
    return this.database.getRepositories();
  }

  async addRepository(owner: string, name: string): Promise<void> {
    // Check if repository exists and is accessible
    const hasAccess = await this.gitHubClient.checkRepositoryAccess(
      owner,
      name,
    );
    if (!hasAccess) {
      throw new Error(
        `Cannot access repository ${owner}/${name}. Check permissions.`,
      );
    }

    this.database.addRepository(owner, name, {
      dailyAttemptLimit: this.settings.repositoryLimits.attemptsPerRepo,
      dailyPRLimit: this.settings.repositoryLimits.prsPerRepo,
      scoreThreshold: this.settings.scanning.issueScoreThreshold,
    });

    this.database.logActivity(
      'info',
      'repository',
      `Added repository ${owner}/${name} to autopilot whitelist`,
    );
  }

  async removeRepository(owner: string, name: string): Promise<void> {
    const removed = this.database.removeRepository(owner, name);
    if (!removed) {
      throw new Error(`Repository ${owner}/${name} not found in whitelist`);
    }

    this.database.logActivity(
      'info',
      'repository',
      `Removed repository ${owner}/${name} from autopilot whitelist`,
    );
  }

  async addToQueue(
    issueUrl: string,
    requestedBy: string,
    priority: number = 0,
  ): Promise<void> {
    const parsedUrl = this.gitHubClient.parseIssueUrl(issueUrl);
    if (!parsedUrl) {
      throw new Error('Invalid GitHub issue URL');
    }

    const { owner, repo, issueNumber } = parsedUrl;

    // Check if repository is whitelisted
    const repositories = this.database.getRepositories();
    const repository = repositories.find(
      (r) => r.owner === owner && r.name === repo,
    );
    if (!repository) {
      throw new Error(
        `Repository ${owner}/${repo} is not whitelisted. Add it first with /autopilot repos add ${owner}/${repo}`,
      );
    }

    // Fetch issue details
    const issueData = await this.gitHubClient.getIssueDetails(
      owner,
      repo,
      issueNumber,
    );

    // Store issue in database
    const issueId = this.database.storeIssue({
      repositoryId: repository.id,
      issueNumber: issueData.number,
      title: issueData.title,
      body: issueData.body || '',
      labels: issueData.labels.map((l) => l.name),
      issueUrl: issueData.html_url,
      attemptCount: 0,
      status: 'pending',
    });

    // Add to queue
    this.database.addToQueue(issueId, requestedBy, priority);

    this.database.logActivity(
      'info',
      'queue',
      `Added issue ${owner}/${repo}#${issueNumber} to manual queue`,
    );
  }

  async getQueue(): Promise<QueueItem[]> {
    return this.database.getQueue();
  }

  private async runMainLoop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      // Check daily limits
      if (!(await this.safetyController.checkDailyLimits())) {
        this.database.logActivity(
          'info',
          'service',
          'Daily limits reached, sleeping until tomorrow',
        );
        this.scheduleNextIteration(24 * 60 * 60 * 1000); // 24 hours
        return;
      }

      // Process manual queue first
      const queueItem = this.database.getNextQueueItem();
      if (queueItem) {
        await this.processQueueItem(queueItem);
      } else {
        // Scan for new issues in repositories
        await this.scanRepositories();
      }

      // Reset error counter on success
      this.consecutiveErrors = 0;

      // Schedule next iteration
      this.scheduleNextIteration(
        this.settings.scanning.intervalMinutes * 60 * 1000,
      );
    } catch (error) {
      this.consecutiveErrors++;
      this.lastErrorTime = Date.now();

      this.database.logActivity(
        'error',
        'service',
        `Main loop error (${this.consecutiveErrors} consecutive): ${(error as Error).message}`,
      );

      // Circuit breaker: if too many consecutive errors, increase delay
      let delayMs = 5 * 60 * 1000; // Base 5 minutes
      if (this.consecutiveErrors >= 5) {
        delayMs = 30 * 60 * 1000; // 30 minutes after 5 errors
        this.database.logActivity(
          'warning',
          'service',
          'Circuit breaker activated: extended delay due to consecutive errors',
        );
      } else if (this.consecutiveErrors >= 3) {
        delayMs = 15 * 60 * 1000; // 15 minutes after 3 errors
      }

      this.scheduleNextIteration(delayMs);
    }
  }

  private scheduleNextIteration(delay: number): void {
    if (this.isRunning) {
      this.mainLoopTimeout = setTimeout(() => {
        this.runMainLoop();
      }, delay);
    }
  }

  private async processQueueItem(queueItem: QueueItem): Promise<void> {
    this.currentActivity = {
      description: `Processing issue ${queueItem.repoOwner}/${queueItem.repoName}#${queueItem.issueId}`,
      startTime: new Date().toISOString(),
    };

    this.database.updateQueueItemStatus(queueItem.id, 'processing');

    try {
      const issue = this.database.getIssue(queueItem.issueId);
      if (!issue) {
        throw new Error('Issue not found in database');
      }

      const repository = this.database.getRepository(issue.repositoryId);
      if (!repository) {
        throw new Error('Repository not found in database');
      }

      // Check repository limits
      if (!(await this.safetyController.checkRepositoryLimits(repository.id))) {
        this.database.updateQueueItemStatus(
          queueItem.id,
          'failed',
          'Repository daily limits reached',
        );
        return;
      }

      // Attempt to solve the issue
      await this.attemptIssueSolution(issue, repository);

      this.database.updateQueueItemStatus(queueItem.id, 'completed');
    } catch (error) {
      this.database.updateQueueItemStatus(
        queueItem.id,
        'failed',
        (error as Error).message,
      );
      this.database.logActivity(
        'error',
        'processing',
        `Failed to process queue item ${queueItem.id}: ${(error as Error).message}`,
      );
    } finally {
      this.currentActivity = undefined;
    }
  }

  private async scanRepositories(): Promise<void> {
    this.currentActivity = {
      description: 'Scanning repositories for new issues',
      startTime: new Date().toISOString(),
    };

    try {
      const repositories = this.database.getRepositories();

      for (const repository of repositories) {
        if (!this.isRunning) break;

        // Check repository limits
        if (
          !(await this.safetyController.checkRepositoryLimits(repository.id))
        ) {
          continue;
        }

        await this.scanRepositoryIssues(repository);
      }
    } catch (error) {
      this.database.logActivity(
        'error',
        'scanning',
        `Repository scan failed: ${(error as Error).message}`,
      );
    } finally {
      this.currentActivity = undefined;
    }
  }

  private async scanRepositoryIssues(repository: Repository): Promise<void> {
    try {
      const issues = await this.gitHubClient.getRepositoryIssues(
        repository.owner,
        repository.name,
      );

      for (const issueData of issues) {
        if (!this.isRunning) break;

        // Check if issue should be attempted
        const shouldAttempt = await this.issueClassifier.shouldAttemptIssue(
          issueData,
          repository.scoreThreshold,
        );

        if (shouldAttempt) {
          // Store issue and attempt to solve it
          const issueId = this.database.storeIssue({
            repositoryId: repository.id,
            issueNumber: issueData.number,
            title: issueData.title,
            body: issueData.body || '',
            labels: issueData.labels.map((l) => l.name),
            issueUrl: issueData.html_url,
            attemptCount: 0,
            status: 'pending',
          });

          const issue = this.database.getIssue(issueId);
          if (issue) {
            await this.attemptIssueSolution(issue, repository);
          }
        }
      }
    } catch (error) {
      this.database.logActivity(
        'error',
        'scanning',
        `Failed to scan ${repository.owner}/${repository.name}: ${(error as Error).message}`,
      );
    }
  }

  private async attemptIssueSolution(
    issue: GitHubIssue,
    repository: Repository,
  ): Promise<void> {
    const startTime = Date.now();
    const timeoutMs = this.settings.safety.timeoutMinutes * 60 * 1000;

    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Operation timeout')), timeoutMs);
    });

    try {
      // Race the actual operation against the timeout
      await Promise.race([
        this.performIssueSolution(issue, repository),
        timeoutPromise,
      ]);
    } catch (error) {
      const duration = Date.now() - startTime;
      this.database.logActivity(
        'error',
        'processing',
        `Issue solution failed after ${Math.round(duration / 1000)}s: ${(error as Error).message}`,
        { issueId: issue.id, repositoryId: repository.id, duration },
      );
      throw error;
    }
  }

  private async performIssueSolution(
    issue: GitHubIssue,
    repository: Repository,
  ): Promise<void> {
    const workspacePath = await this.safetyController.createWorkspace(issue.id);
    const attemptId = this.database.startAttempt(issue.id, workspacePath);
    const contextId = `issue-${issue.id}-${attemptId}`;
    const branchName = `autopilot-fix-issue-${issue.issueNumber}`;

    // Register recovery context
    this.errorRecovery.registerContext(contextId, {
      attemptId,
      issueId: issue.id,
      repositoryId: repository.id,
      workspacePath,
      branchName,
      operation: 'issue_processing',
      startTime: new Date(),
    });

    try {
      // Clone repository
      await this.gitHubClient.cloneRepository(
        repository.owner,
        repository.name,
        workspacePath,
      );

      // Create branch
      await this.gitHubClient.createBranch(workspacePath, branchName);

      // Solve issue with Gemini integration
      const solutionResult = await this.geminiIntegration.solveIssue(
        issue,
        workspacePath,
        repository.owner,
        repository.name,
      );

      if (solutionResult.success) {
        // Run tests if required
        if (this.settings.safety.requireTests) {
          const testResult =
            await this.safetyController.validateTestExecution(workspacePath);
          if (!testResult.passed) {
            throw new Error(`Tests failed: ${testResult.results}`);
          }
        }

        // Commit and push changes
        await this.gitHubClient.commitChanges(
          workspacePath,
          `Fix issue #${issue.issueNumber}: ${issue.title}`,
        );
        await this.gitHubClient.pushBranch(workspacePath, branchName);

        // Create pull request
        const prResult = await this.gitHubClient.createPullRequest(
          repository.owner,
          repository.name,
          branchName,
          `Fix issue #${issue.issueNumber}: ${issue.title}`,
          `This PR addresses issue #${issue.issueNumber}.

${solutionResult.output || 'Automated fix applied.'}

---
*This PR was automatically generated by Gemini CLI Autopilot.*`,
        );

        // Mark attempt as successful
        this.database.completeAttempt(attemptId, 'success', {
          success: true,
          prNumber: prResult.number,
          prUrl: prResult.url,
          aiCost: solutionResult.estimatedCost || 0,
          solutionSummary: solutionResult.output,
        });

        // Unregister recovery context on success
        this.errorRecovery.unregisterContext(contextId);
      } else {
        throw new Error(solutionResult.error || 'Solution generation failed');
      }
    } catch (error) {
      // Use error recovery system
      await this.errorRecovery.handleError(contextId, error as Error);
      throw error;
    } finally {
      // Cleanup workspace
      await this.safetyController.cleanupWorkspace(workspacePath);
    }
  }
}
