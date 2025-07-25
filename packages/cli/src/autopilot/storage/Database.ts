/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import {
  Repository,
  GitHubIssue,
  AttemptHistory,
  QueueItem,
  DailyStats,
  Activity,
  AttemptResult,
  RepositoryConfig,
  RepositoryRow,
  IssueRow,
  QueueRow,
  AttemptRow,
  ActivityRow,
  StatsRow,
  ActivityMetadata,
  RepositoryStatsRow,
} from '../types.js';

export class AutopilotDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    // Ensure the directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON'); // Enable foreign key constraints
  }

  // Transaction wrapper for complex operations
  transaction<T>(fn: () => T): T {
    const transactionFn = this.db.transaction(fn);
    return transactionFn();
  }

  async initialize(): Promise<void> {
    // Use proper cross-platform path resolution for ES modules
    const currentModulePath = fileURLToPath(import.meta.url);
    const schemaPath = path.resolve(
      path.dirname(currentModulePath),
      'schema.sql',
    );
    const schema = fs.readFileSync(schemaPath, 'utf8');
    this.db.exec(schema);
  }

  close(): void {
    this.db.close();
  }

  // Repository management
  addRepository(owner: string, name: string, config: RepositoryConfig): number {
    const stmt = this.db.prepare(`
      INSERT INTO repositories (owner, name, daily_attempt_limit, daily_pr_limit, score_threshold)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      owner,
      name,
      config.dailyAttemptLimit,
      config.dailyPRLimit,
      config.scoreThreshold,
    );
    return result.lastInsertRowid as number;
  }

  getRepositories(): Repository[] {
    const stmt = this.db.prepare(`
      SELECT r.*, 
             COALESCE(rds.attempts, 0) as today_attempts,
             COALESCE(rds.prs, 0) as today_prs
      FROM repositories r
      LEFT JOIN repo_daily_stats rds ON r.id = rds.repository_id 
        AND rds.date = DATE('now')
      WHERE r.enabled = 1
      ORDER BY r.owner, r.name
    `);

    const rows = stmt.all() as RepositoryRow[];
    return rows.map((row) => ({
      id: row.id,
      owner: row.owner,
      name: row.name,
      enabled: !!row.enabled,
      dailyAttemptLimit: row.daily_attempt_limit,
      dailyPRLimit: row.daily_pr_limit,
      scoreThreshold: row.score_threshold,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      todayAttempts: row.today_attempts,
      todayPRs: row.today_prs,
    }));
  }

  getRepository(id: number): Repository | null {
    const stmt = this.db.prepare(`
      SELECT r.*, 
             COALESCE(rds.attempts, 0) as today_attempts,
             COALESCE(rds.prs, 0) as today_prs
      FROM repositories r
      LEFT JOIN repo_daily_stats rds ON r.id = rds.repository_id 
        AND rds.date = DATE('now')
      WHERE r.id = ?
    `);

    const row = stmt.get(id) as RepositoryRow | undefined;
    if (!row) return null;

    return {
      id: row.id,
      owner: row.owner,
      name: row.name,
      enabled: !!row.enabled,
      dailyAttemptLimit: row.daily_attempt_limit,
      dailyPRLimit: row.daily_pr_limit,
      scoreThreshold: row.score_threshold,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      todayAttempts: row.today_attempts,
      todayPRs: row.today_prs,
    };
  }

  removeRepository(owner: string, name: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM repositories WHERE owner = ? AND name = ?
    `);

    const result = stmt.run(owner, name);
    return result.changes > 0;
  }

  // Issue management with enhanced tracking
  storeIssue(
    issue: Omit<GitHubIssue, 'id' | 'createdAt' | 'updatedAt'>,
  ): number {
    // Validate required fields
    if (!issue.repositoryId || !issue.issueNumber || !issue.title) {
      throw new Error('Missing required fields for issue storage');
    }

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO issues 
      (repository_id, issue_number, title, body, labels, issue_url, complexity_score, classification_metadata, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      issue.repositoryId,
      issue.issueNumber,
      issue.title.substring(0, 500), // Limit title length
      issue.body ? issue.body.substring(0, 10000) : null, // Limit body length
      JSON.stringify(issue.labels || []),
      issue.issueUrl,
      issue.complexityScore || null,
      issue.classificationMetadata
        ? JSON.stringify(issue.classificationMetadata)
        : null,
      issue.status,
    );

    return result.lastInsertRowid as number;
  }

  // Transactional issue processing
  processIssueWithQueue(
    issue: Omit<GitHubIssue, 'id' | 'createdAt' | 'updatedAt'>,
    requestedBy: string,
    priority: number = 0,
  ): { issueId: number; queueId: number } {
    return this.transaction(() => {
      // Store the issue
      const issueId = this.storeIssue(issue);

      // Add to queue
      const queueStmt = this.db.prepare(`
        INSERT INTO issue_queue (issue_id, priority, requested_by)
        VALUES (?, ?, ?)
      `);

      const queueResult = queueStmt.run(issueId, priority, requestedBy);

      return {
        issueId,
        queueId: queueResult.lastInsertRowid as number,
      };
    });
  }

  getIssue(id: number): GitHubIssue | null {
    const stmt = this.db.prepare(`
      SELECT * FROM issues WHERE id = ?
    `);

    const row = stmt.get(id) as IssueRow | undefined;
    if (!row) return null;

    return {
      id: row.id,
      repositoryId: row.repository_id,
      issueNumber: row.issue_number,
      title: row.title,
      body: row.body,
      labels: JSON.parse(row.labels || '[]'),
      issueUrl: row.issue_url,
      complexityScore: row.complexity_score ?? undefined,
      classificationMetadata: row.classification_metadata
        ? JSON.parse(row.classification_metadata)
        : undefined,
      lastAttemptedAt: row.last_attempted_at ?? undefined,
      attemptCount: row.attempt_count,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // Attempt tracking with detailed metrics
  startAttempt(issueId: number, workspacePath: string): number {
    const stmt = this.db.prepare(`
      INSERT INTO attempt_history (issue_id, workspace_path, status)
      VALUES (?, ?, 'in_progress')
    `);

    const result = stmt.run(issueId, workspacePath);

    // Update issue attempt count
    const updateStmt = this.db.prepare(`
      UPDATE issues 
      SET attempt_count = attempt_count + 1, last_attempted_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    updateStmt.run(issueId);

    return result.lastInsertRowid as number;
  }

  completeAttempt(
    attemptId: number,
    status: 'success' | 'failure' | 'timeout',
    result: AttemptResult,
  ): void {
    const stmt = this.db.prepare(`
      UPDATE attempt_history 
      SET completed_at = CURRENT_TIMESTAMP,
          status = ?,
          error_message = ?,
          pr_number = ?,
          pr_url = ?,
          ai_cost_usd = ?,
          solution_summary = ?,
          test_results = ?,
          code_changes_summary = ?
      WHERE id = ?
    `);

    stmt.run(
      status,
      result.error || null,
      result.prNumber || null,
      result.prUrl || null,
      result.aiCost || 0,
      result.solutionSummary || null,
      result.testResults ? JSON.stringify(result.testResults) : null,
      result.codeChangesSummary || null,
      attemptId,
    );

    // Update daily stats
    this.updateDailyStats(result.aiCost || 0, status === 'success');
  }

  getAttemptHistory(issueId: number): AttemptHistory[] {
    const stmt = this.db.prepare(`
      SELECT * FROM attempt_history 
      WHERE issue_id = ? 
      ORDER BY started_at DESC
    `);

    const rows = stmt.all(issueId) as AttemptRow[];
    return rows.map((row) => ({
      id: row.id,
      issueId: row.issue_id,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      status: row.status,
      errorMessage: row.error_message ?? undefined,
      workspacePath: row.workspace_path ?? undefined,
      prNumber: row.pr_number ?? undefined,
      prUrl: row.pr_url ?? undefined,
      aiCostUsd: row.ai_cost_usd,
      classificationScore: row.classification_score ?? undefined,
      solutionSummary: row.solution_summary ?? undefined,
      testResults: row.test_results ? JSON.parse(row.test_results) : undefined,
      codeChangesSummary: row.code_changes_summary ?? undefined,
    }));
  }

  // Enhanced queue management
  addToQueue(
    issueId: number,
    requestedBy: string,
    priority: number = 0,
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO issue_queue (issue_id, requested_by, priority)
      VALUES (?, ?, ?)
    `);

    const result = stmt.run(issueId, requestedBy, priority);
    return result.lastInsertRowid as number;
  }

  getNextQueueItem(): QueueItem | null {
    const stmt = this.db.prepare(`
      SELECT q.*, i.title, i.issue_url, r.owner, r.name
      FROM issue_queue q
      JOIN issues i ON q.issue_id = i.id
      JOIN repositories r ON i.repository_id = r.id
      WHERE q.status = 'pending'
      ORDER BY q.priority DESC, q.requested_at ASC
      LIMIT 1
    `);

    const row = stmt.get() as QueueRow | undefined;
    if (!row) return null;

    return {
      id: row.id,
      issueId: row.issue_id,
      priority: row.priority,
      status: row.status,
      requestedBy: row.requested_by,
      requestedAt: row.requested_at,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      errorMessage: row.error_message ?? undefined,
      estimatedCompletionTime: row.estimated_completion_time ?? undefined,
      title: row.title,
      issueUrl: row.issue_url,
      repoOwner: row.owner,
      repoName: row.name,
    };
  }

  getQueue(): QueueItem[] {
    const stmt = this.db.prepare(`
      SELECT q.*, i.title, i.issue_url, r.owner, r.name
      FROM issue_queue q
      JOIN issues i ON q.issue_id = i.id
      JOIN repositories r ON i.repository_id = r.id
      ORDER BY q.priority DESC, q.requested_at ASC
    `);

    const rows = stmt.all() as QueueRow[];
    return rows.map((row) => ({
      id: row.id,
      issueId: row.issue_id,
      priority: row.priority,
      status: row.status,
      requestedBy: row.requested_by,
      requestedAt: row.requested_at,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      errorMessage: row.error_message ?? undefined,
      estimatedCompletionTime: row.estimated_completion_time ?? undefined,
      title: row.title,
      issueUrl: row.issue_url,
      repoOwner: row.owner,
      repoName: row.name,
    }));
  }

  updateQueueItemStatus(
    id: number,
    status: string,
    errorMessage?: string,
  ): void {
    const stmt = this.db.prepare(`
      UPDATE issue_queue 
      SET status = ?, 
          error_message = ?,
          ${status === 'processing' ? 'started_at = CURRENT_TIMESTAMP,' : ''}
          ${status === 'completed' || status === 'failed' ? 'completed_at = CURRENT_TIMESTAMP,' : ''}
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(status, errorMessage || null, id);
  }

  // Activity logging
  logActivity(
    level: 'info' | 'warning' | 'error' | 'debug',
    category: string,
    message: string,
    metadata?: ActivityMetadata,
    issueId?: number,
    repositoryId?: number,
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO activity_log (level, category, message, metadata, issue_id, repository_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      level,
      category,
      message,
      metadata ? JSON.stringify(metadata) : null,
      issueId || null,
      repositoryId || null,
    );
  }

  getRecentActivity(limit: number = 50): Activity[] {
    const stmt = this.db.prepare(`
      SELECT * FROM activity_log
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as ActivityRow[];
    return rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      level: row.level,
      category: row.category,
      message: row.message,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      issueId: row.issue_id ?? undefined,
      repositoryId: row.repository_id ?? undefined,
    }));
  }

  // Statistics and monitoring
  getDailyStats(date: Date): DailyStats {
    const stmt = this.db.prepare(`
      SELECT * FROM daily_stats WHERE date = ?
    `);

    const dateStr = date.toISOString().split('T')[0];
    const stats = stmt.get(dateStr) as DailyStats | undefined;

    return (
      stats || {
        date: dateStr,
        totalAttempts: 0,
        totalPrs: 0,
        totalCostUsd: 0,
        successfulAttempts: 0,
        failedAttempts: 0,
        avgCompletionTimeMinutes: 0,
      }
    );
  }

  getRepositoryDailyStats(
    repositoryId: number,
    date: Date,
  ): { attempts: number; prs: number; cost: number } {
    const stmt = this.db.prepare(`
      SELECT attempts, prs, cost_usd FROM repo_daily_stats 
      WHERE repository_id = ? AND date = ?
    `);

    const dateStr = date.toISOString().split('T')[0];
    const stats = stmt.get(repositoryId, dateStr) as
      | RepositoryStatsRow
      | undefined;

    return {
      attempts: stats?.attempts || 0,
      prs: stats?.prs || 0,
      cost: stats?.cost_usd || 0,
    };
  }

  private updateDailyStats(cost: number, success: boolean): void {
    const today = new Date().toISOString().split('T')[0];

    const stmt = this.db.prepare(`
      INSERT INTO daily_stats (date, total_attempts, total_prs, total_cost_usd, successful_attempts, failed_attempts)
      VALUES (?, 1, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        total_attempts = total_attempts + 1,
        total_prs = total_prs + ?,
        total_cost_usd = total_cost_usd + ?,
        successful_attempts = successful_attempts + ?,
        failed_attempts = failed_attempts + ?
    `);

    stmt.run(
      today,
      success ? 1 : 0,
      cost,
      success ? 1 : 0,
      success ? 0 : 1,
      success ? 1 : 0,
      cost,
      success ? 1 : 0,
      success ? 0 : 1,
    );
  }

  getQueueStats(): { pending: number; processing: number; completed: number } {
    const stmt = this.db.prepare(`
      SELECT status, COUNT(*) as count
      FROM issue_queue
      GROUP BY status
    `);

    const rows = stmt.all() as StatsRow[];
    const stats = { pending: 0, processing: 0, completed: 0 };

    for (const row of rows) {
      if (row.status in stats) {
        (stats as Record<string, number>)[row.status] = row.count;
      }
    }

    return stats;
  }
}
