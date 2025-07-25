/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config, ShellTool } from '@google/gemini-cli-core';
import { AutopilotDatabase } from '../storage/Database.js';

export interface GitHubIssueData {
  number: number;
  title: string;
  body: string;
  labels: Array<{ name: string }>;
  html_url: string;
  state: string;
}

export class GitHubClient {
  private config: Config;
  private shellTool: ShellTool;
  private database: AutopilotDatabase;

  constructor(config: Config, database: AutopilotDatabase) {
    this.config = config;
    this.shellTool = new ShellTool(config);
    this.database = database;
  }

  async getRepositoryIssues(
    owner: string,
    repo: string,
  ): Promise<GitHubIssueData[]> {
    const command = `gh issue list -R ${owner}/${repo} --json number,title,body,labels,html_url,state --state open --limit 50`;

    try {
      const result = await this.shellTool.execute(
        { command },
        new AbortController().signal,
      );

      if (
        result.llmContent &&
        !result.llmContent.toString().toLowerCase().includes('error')
      ) {
        const issues = JSON.parse(
          result.llmContent.toString(),
        ) as GitHubIssueData[];

        this.database.logActivity(
          'info',
          'github',
          `Fetched ${issues.length} issues from ${owner}/${repo}`,
        );

        return issues;
      }

      throw new Error(
        `Failed to fetch issues: ${result.llmContent.toString()}`,
      );
    } catch (error) {
      this.database.logActivity(
        'error',
        'github',
        `Failed to fetch issues from ${owner}/${repo}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  async getIssueDetails(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<GitHubIssueData> {
    const command = `gh issue view ${issueNumber} -R ${owner}/${repo} --json number,title,body,labels,html_url,state`;

    try {
      const result = await this.shellTool.execute(
        { command },
        new AbortController().signal,
      );

      if (
        result.llmContent &&
        !result.llmContent.toString().toLowerCase().includes('error')
      ) {
        const issue = JSON.parse(
          result.llmContent.toString(),
        ) as GitHubIssueData;
        return issue;
      }

      throw new Error(
        `Failed to fetch issue details: ${result.llmContent.toString()}`,
      );
    } catch (error) {
      this.database.logActivity(
        'error',
        'github',
        `Failed to fetch issue details ${owner}/${repo}#${issueNumber}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  async cloneRepository(
    owner: string,
    repo: string,
    workspacePath: string,
  ): Promise<void> {
    const command = `gh repo clone ${owner}/${repo} "${workspacePath}"`;

    try {
      const result = await this.shellTool.execute(
        { command },
        new AbortController().signal,
      );

      if (result.llmContent.toString().toLowerCase().includes('error')) {
        throw new Error(
          `Failed to clone repository: ${result.llmContent.toString()}`,
        );
      }

      this.database.logActivity(
        'info',
        'github',
        `Successfully cloned ${owner}/${repo} to ${workspacePath}`,
      );
    } catch (error) {
      this.database.logActivity(
        'error',
        'github',
        `Failed to clone ${owner}/${repo}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  async createBranch(workspacePath: string, branchName: string): Promise<void> {
    const command = `git checkout -b ${branchName}`;

    try {
      const result = await this.shellTool.execute(
        {
          command,
          directory: workspacePath,
        },
        new AbortController().signal,
      );

      if (result.llmContent.toString().toLowerCase().includes('error')) {
        throw new Error(
          `Failed to create branch: ${result.llmContent.toString()}`,
        );
      }

      this.database.logActivity(
        'info',
        'github',
        `Created branch ${branchName} in ${workspacePath}`,
      );
    } catch (error) {
      this.database.logActivity(
        'error',
        'github',
        `Failed to create branch ${branchName}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  async commitChanges(workspacePath: string, message: string): Promise<void> {
    try {
      // Validate message length and content
      if (!message || message.trim().length === 0) {
        throw new Error('Commit message cannot be empty');
      }
      if (message.length > 1000) {
        throw new Error('Commit message too long (max 1000 characters)');
      }

      // Add all changes
      await this.shellTool.execute(
        {
          command: 'git add .',
          directory: workspacePath,
        },
        new AbortController().signal,
      );

      // Create safe commit message without shell injection risk
      const cleanMessage = message.replace(/[\r\n\0]/g, ' ').trim();
      const fullCommitMessage = `${cleanMessage}

🤖 Generated with [Gemini CLI Autopilot](https://github.com/google/gemini-cli)

Co-Authored-By: Gemini <noreply@google.com>`;

      // Use git commit with stdin to avoid shell injection
      const commitResult = await this.shellTool.execute(
        {
          command: `echo "${fullCommitMessage.replace(/"/g, '\\"')}" | git commit -F -`,
          directory: workspacePath,
        },
        new AbortController().signal,
      );

      if (commitResult.llmContent.toString().toLowerCase().includes('error')) {
        throw new Error(
          `Failed to commit changes: ${commitResult.llmContent.toString()}`,
        );
      }

      this.database.logActivity(
        'info',
        'github',
        `Committed changes in ${workspacePath}`,
      );
    } catch (error) {
      this.database.logActivity(
        'error',
        'github',
        `Failed to commit changes: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  async pushBranch(workspacePath: string, branchName: string): Promise<void> {
    const command = `git push -u origin ${branchName}`;

    try {
      const result = await this.shellTool.execute(
        {
          command,
          directory: workspacePath,
        },
        new AbortController().signal,
      );

      if (result.llmContent.toString().toLowerCase().includes('error')) {
        throw new Error(
          `Failed to push branch: ${result.llmContent.toString()}`,
        );
      }

      this.database.logActivity(
        'info',
        'github',
        `Pushed branch ${branchName} from ${workspacePath}`,
      );
    } catch (error) {
      this.database.logActivity(
        'error',
        'github',
        `Failed to push branch ${branchName}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  async createPullRequest(
    owner: string,
    repo: string,
    branchName: string,
    title: string,
    body: string,
  ): Promise<{ number: number; url: string }> {
    // Validate inputs
    if (!this.isValidRepoName(owner) || !this.isValidRepoName(repo)) {
      throw new Error('Invalid repository owner or name');
    }
    if (!this.isValidBranchName(branchName)) {
      throw new Error('Invalid branch name');
    }
    if (!title || title.trim().length === 0 || title.length > 200) {
      throw new Error('Invalid PR title (must be 1-200 characters)');
    }
    if (body.length > 5000) {
      throw new Error('PR body too long (max 5000 characters)');
    }

    // Clean inputs for safety
    const cleanTitle = title.replace(/[\r\n\0]/g, ' ').trim();
    const cleanBody = body
      .replace(/[\r\n]/g, '\\n')
      .replace(/\0/g, '')
      .trim();

    const command = `gh pr create -R ${owner}/${repo} --head ${branchName} --title "${cleanTitle.replace(/"/g, '\\"')}" --body "${cleanBody.replace(/"/g, '\\"')}" --json number,url`;

    try {
      const result = await this.shellTool.execute(
        { command },
        new AbortController().signal,
      );

      if (
        result.llmContent &&
        !result.llmContent.toString().toLowerCase().includes('error')
      ) {
        const prData = JSON.parse(result.llmContent.toString());

        this.database.logActivity(
          'info',
          'github',
          `Created pull request #${prData.number} for ${owner}/${repo}`,
        );

        return {
          number: prData.number,
          url: prData.url,
        };
      }

      throw new Error(`Failed to create PR: ${result.llmContent.toString()}`);
    } catch (error) {
      this.database.logActivity(
        'error',
        'github',
        `Failed to create pull request for ${owner}/${repo}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  async checkRepositoryAccess(owner: string, repo: string): Promise<boolean> {
    const command = `gh repo view ${owner}/${repo} --json name`;

    try {
      const result = await this.shellTool.execute(
        { command },
        new AbortController().signal,
      );
      return !result.llmContent.toString().toLowerCase().includes('error');
    } catch {
      return false;
    }
  }

  parseIssueUrl(
    issueUrl: string,
  ): { owner: string; repo: string; issueNumber: number } | null {
    const match = issueUrl.match(
      /github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/,
    );
    if (!match) {
      return null;
    }

    return {
      owner: match[1],
      repo: match[2],
      issueNumber: parseInt(match[3], 10),
    };
  }

  private isValidRepoName(name: string): boolean {
    // GitHub repo/owner names: alphanumeric, hyphens, underscores, dots, max 100 chars
    return /^[a-zA-Z0-9._-]{1,100}$/.test(name);
  }

  private isValidBranchName(name: string): boolean {
    // Git branch names: no spaces, control chars, or dangerous characters
    return /^[a-zA-Z0-9._-]{1,250}$/.test(name) && !name.includes('..');
  }
}
