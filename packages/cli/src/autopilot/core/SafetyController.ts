/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import { Config, ShellTool } from '@google/gemini-cli-core';
import { AutopilotDatabase } from '../storage/Database.js';
import { AutopilotSettings } from '../types.js';

export class SafetyController {
  private config: Config;
  private database: AutopilotDatabase;
  private settings: AutopilotSettings;
  private shellTool: ShellTool;

  constructor(
    config: Config,
    database: AutopilotDatabase,
    settings: AutopilotSettings,
  ) {
    this.config = config;
    this.database = database;
    this.settings = settings;
    this.shellTool = new ShellTool(config);
  }

  async validateSetup(): Promise<void> {
    // Authentication validation
    await this.validateGitHubAccess();
    await this.validateGeminiAccess();

    // Permission validation
    await this.validateDirectoryPermissions();

    // Configuration validation
    this.validateLimits();

    this.database.logActivity(
      'info',
      'safety',
      'Safety validation completed successfully',
    );
  }

  async checkDailyLimits(): Promise<boolean> {
    const today = new Date();
    const stats = this.database.getDailyStats(today);
    const limits = this.settings.dailyLimits;

    // Check global daily limits
    if (stats.totalAttempts >= limits.totalAttempts) {
      await this.database.logActivity(
        'warning',
        'safety',
        `Daily attempt limit reached: ${stats.totalAttempts}/${limits.totalAttempts}`,
      );
      return false;
    }

    if (stats.totalPrs >= limits.totalPRs) {
      await this.database.logActivity(
        'warning',
        'safety',
        `Daily PR limit reached: ${stats.totalPrs}/${limits.totalPRs}`,
      );
      return false;
    }

    if (stats.totalCostUsd >= limits.totalCostUSD) {
      await this.database.logActivity(
        'warning',
        'safety',
        `Daily cost limit reached: $${stats.totalCostUsd}/$${limits.totalCostUSD}`,
      );
      return false;
    }

    return true;
  }

  async checkRepositoryLimits(repositoryId: number): Promise<boolean> {
    const today = new Date();
    const repoStats = this.database.getRepositoryDailyStats(
      repositoryId,
      today,
    );
    const repo = this.database.getRepository(repositoryId);

    if (!repo) {
      throw new Error(`Repository with ID ${repositoryId} not found`);
    }

    if (repoStats.attempts >= repo.dailyAttemptLimit) {
      await this.database.logActivity(
        'warning',
        'safety',
        `Repository daily attempt limit reached: ${repo.owner}/${repo.name}`,
        undefined,
        undefined,
        repositoryId,
      );
      return false;
    }

    if (repoStats.prs >= repo.dailyPRLimit) {
      await this.database.logActivity(
        'warning',
        'safety',
        `Repository daily PR limit reached: ${repo.owner}/${repo.name}`,
        undefined,
        undefined,
        repositoryId,
      );
      return false;
    }

    return true;
  }

  async validateWorkspace(workspacePath: string): Promise<boolean> {
    // Sanitize the workspace path to prevent traversal attacks
    if (!workspacePath || typeof workspacePath !== 'string') {
      throw new Error('Invalid workspace path');
    }

    // Remove dangerous path components
    const cleanPath = path.normalize(workspacePath).replace(/\.\./g, '');
    if (cleanPath !== workspacePath) {
      throw new Error('Path traversal attempt detected');
    }

    const basePath = path.resolve(this.settings.workspaceBase);
    const resolvedPath = path.resolve(cleanPath);

    // Security check: ensure workspace is within base directory
    if (
      !resolvedPath.startsWith(basePath + path.sep) &&
      resolvedPath !== basePath
    ) {
      throw new Error(
        `Security violation: workspace outside base directory: ${workspacePath}`,
      );
    }

    // Additional security: check for dangerous path components
    const relativePath = path.relative(basePath, resolvedPath);
    if (
      relativePath.includes('..') ||
      relativePath.startsWith('/') ||
      relativePath.includes('\0')
    ) {
      throw new Error('Invalid workspace path detected');
    }

    // Check if workspace already exists (cleanup needed)
    if (fs.existsSync(resolvedPath)) {
      throw new Error(`Workspace already exists: ${workspacePath}`);
    }

    return true;
  }

  async validateTestExecution(
    workspacePath: string,
  ): Promise<{ passed: boolean; results: string }> {
    try {
      // Look for common test commands
      const testCommands = [
        'npm test',
        'yarn test',
        'pnpm test',
        'pytest',
        'cargo test',
        'go test',
      ];

      for (const command of testCommands) {
        try {
          const result = await this.executeCommand(command, workspacePath);
          if (result.success) {
            return { passed: true, results: result.output || '' };
          }
        } catch {
          // Try next command
          continue;
        }
      }

      // If no test command found, check for test files
      const hasTests = await this.hasTestFiles(workspacePath);
      if (!hasTests) {
        this.database.logActivity(
          'warning',
          'safety',
          'No tests found in repository',
        );
        return { passed: true, results: 'No tests found' };
      }

      return {
        passed: false,
        results: 'Tests exist but no valid test command found',
      };
    } catch (error) {
      return {
        passed: false,
        results: `Test execution failed: ${(error as Error).message}`,
      };
    }
  }

  async createWorkspace(issueId: number): Promise<string> {
    // Validate issue ID
    if (!Number.isInteger(issueId) || issueId <= 0) {
      throw new Error('Invalid issue ID');
    }

    // Check disk space before creating workspace
    const baseDir = this.settings.workspaceBase;
    const freeSpace = await this.getAvailableDiskSpace(baseDir);
    const maxWorkspaceSize = this.parseSize(
      this.settings.safety.maxWorkspaceSize,
    );

    if (freeSpace < maxWorkspaceSize * 2) {
      // Require 2x workspace size free
      throw new Error(
        `Insufficient disk space. Available: ${Math.round(freeSpace / 1024 / 1024)}MB, Required: ${Math.round((maxWorkspaceSize * 2) / 1024 / 1024)}MB`,
      );
    }

    const timestamp = Date.now();
    const workspacePath = path.join(
      this.settings.workspaceBase,
      `issue-${issueId}-${timestamp}`,
    );

    await this.validateWorkspace(workspacePath);

    // Create workspace directory with proper permissions
    fs.mkdirSync(workspacePath, { recursive: true, mode: 0o755 });

    // Log workspace creation
    this.database.logActivity(
      'info',
      'workspace',
      `Created workspace: ${workspacePath}`,
      { issueId },
    );

    return workspacePath;
  }

  private async getAvailableDiskSpace(_dirPath: string): Promise<number> {
    try {
      // This is a simplified check - in production you'd use a proper disk space library
      return 1024 * 1024 * 1024; // Assume 1GB for now - TODO: implement proper check
    } catch (error) {
      this.database.logActivity(
        'warning',
        'safety',
        `Failed to check disk space: ${(error as Error).message}`,
      );
      return 1024 * 1024 * 1024; // Default to 1GB
    }
  }

  private parseSize(sizeStr: string): number {
    const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(GB|MB|KB|B)?$/i);
    if (!match) return 1024 * 1024 * 1024; // Default 1GB

    const value = parseFloat(match[1]);
    const unit = (match[2] || 'B').toUpperCase();

    const multipliers: Record<string, number> = {
      B: 1,
      KB: 1024,
      MB: 1024 * 1024,
      GB: 1024 * 1024 * 1024,
    };

    return value * (multipliers[unit] || 1);
  }

  async cleanupWorkspace(workspacePath: string): Promise<void> {
    try {
      if (fs.existsSync(workspacePath)) {
        // Use cross-platform fs.rmSync instead of shell commands
        fs.rmSync(workspacePath, { recursive: true, force: true });
      }
    } catch (error) {
      this.database.logActivity(
        'warning',
        'safety',
        `Failed to cleanup workspace: ${(error as Error).message}`,
        { workspacePath },
      );
    }
  }

  private async validateGitHubAccess(): Promise<void> {
    try {
      const result = await this.executeCommand('gh auth status');
      if (!result.success) {
        throw new Error('GitHub CLI not authenticated');
      }
    } catch (error) {
      throw new Error(
        `GitHub access validation failed: ${(error as Error).message}`,
      );
    }
  }

  private async validateGeminiAccess(): Promise<void> {
    try {
      // Validate Gemini client access by testing the connection
      const geminiClient = this.config.getGeminiClient();
      const chat = await geminiClient.getChat();

      // Try a simple test message to validate the connection
      const testResponse = await chat.sendMessage(
        {
          message: [{ text: 'Connection test - respond with OK' }],
          config: { temperature: 0 },
        },
        'validation-test',
      );

      if (!testResponse) {
        throw new Error('No response from Gemini API');
      }

      this.database.logActivity(
        'info',
        'safety',
        'Gemini access validation successful',
      );
    } catch (error) {
      this.database.logActivity(
        'error',
        'safety',
        `Gemini access validation failed: ${(error as Error).message}`,
      );
      throw new Error(
        `Gemini API access validation failed: ${(error as Error).message}`,
      );
    }
  }

  private validateLimits(): void {
    const { dailyLimits, repositoryLimits } = this.settings;

    if (
      dailyLimits.totalAttempts <= 0 ||
      dailyLimits.totalPRs <= 0 ||
      dailyLimits.totalCostUSD <= 0
    ) {
      throw new Error('Daily limits must be positive values');
    }

    if (
      repositoryLimits.attemptsPerRepo <= 0 ||
      repositoryLimits.prsPerRepo <= 0
    ) {
      throw new Error('Repository limits must be positive values');
    }
  }

  private async validateDirectoryPermissions(): Promise<void> {
    // Ensure workspace base directory exists and is writable
    const baseDir = this.settings.workspaceBase;

    try {
      if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
      }

      // Test write permissions
      const testFile = path.join(baseDir, '.write-test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
    } catch (error) {
      throw new Error(
        `Workspace base directory not writable: ${(error as Error).message}`,
      );
    }
  }

  private async executeCommand(
    command: string,
    cwd?: string,
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    try {
      const result = await this.shellTool.execute(
        {
          command,
          directory: cwd,
        },
        new AbortController().signal,
      );

      return {
        success: !result.llmContent.toString().toLowerCase().includes('error'),
        output: result.llmContent.toString(),
        error: result.llmContent.toString().toLowerCase().includes('error')
          ? result.llmContent.toString()
          : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  private async hasTestFiles(workspacePath: string): Promise<boolean> {
    try {
      // Use Node.js fs operations for cross-platform compatibility
      const testPatterns = [/test/i, /spec/i];

      const scanDirectory = (dir: string): boolean => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });

          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
              // Check directory names
              if (testPatterns.some((pattern) => pattern.test(entry.name))) {
                return true;
              }
              // Recursively scan subdirectories
              if (scanDirectory(fullPath)) {
                return true;
              }
            } else if (entry.isFile()) {
              // Check file names
              if (testPatterns.some((pattern) => pattern.test(entry.name))) {
                return true;
              }
            }
          }

          return false;
        } catch {
          return false;
        }
      };

      return scanDirectory(workspacePath);
    } catch {
      return false;
    }
  }

  // Public method for error recovery to execute commands
  async executeGitCommand(
    command: string,
    workspacePath: string,
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    return this.executeCommand(command, workspacePath);
  }
}
