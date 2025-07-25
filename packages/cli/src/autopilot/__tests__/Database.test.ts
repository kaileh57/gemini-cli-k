/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AutopilotDatabase } from '../storage/Database.js';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

describe('AutopilotDatabase', () => {
  let database: AutopilotDatabase;
  let dbPath: string;

  beforeEach(async () => {
    // Create temporary database file
    const tempDir = path.join(tmpdir(), 'autopilot-db-test-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    dbPath = path.join(tempDir, 'test.db');

    database = new AutopilotDatabase(dbPath);
    await database.initialize();
  });

  afterEach(() => {
    database.close();

    // Cleanup
    const tempDir = path.dirname(dbPath);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Repository Management', () => {
    it('should add and retrieve repositories', () => {
      const repoId = database.addRepository('owner', 'repo', {
        dailyAttemptLimit: 3,
        dailyPRLimit: 2,
        scoreThreshold: 70,
      });

      expect(repoId).toBeGreaterThan(0);

      const repositories = database.getRepositories();
      expect(repositories).toHaveLength(1);
      expect(repositories[0]).toMatchObject({
        id: repoId,
        owner: 'owner',
        name: 'repo',
        enabled: true,
        dailyAttemptLimit: 3,
        dailyPRLimit: 2,
        scoreThreshold: 70,
        todayAttempts: 0,
        todayPRs: 0,
      });
    });

    it('should retrieve repository by id', () => {
      const repoId = database.addRepository('owner', 'repo', {
        dailyAttemptLimit: 3,
        dailyPRLimit: 2,
        scoreThreshold: 70,
      });

      const repository = database.getRepository(repoId);
      expect(repository).not.toBeNull();
      expect(repository?.owner).toBe('owner');
      expect(repository?.name).toBe('repo');
    });

    it('should remove repositories', () => {
      database.addRepository('owner', 'repo', {
        dailyAttemptLimit: 3,
        dailyPRLimit: 2,
        scoreThreshold: 70,
      });

      const removed = database.removeRepository('owner', 'repo');
      expect(removed).toBe(true);

      const repositories = database.getRepositories();
      expect(repositories).toHaveLength(0);
    });

    it('should handle removing non-existent repository', () => {
      const removed = database.removeRepository('nonexistent', 'repo');
      expect(removed).toBe(false);
    });
  });

  describe('Issue Management', () => {
    let repositoryId: number;

    beforeEach(() => {
      repositoryId = database.addRepository('owner', 'repo', {
        dailyAttemptLimit: 3,
        dailyPRLimit: 2,
        scoreThreshold: 70,
      });
    });

    it('should store and retrieve issues', () => {
      const issueId = database.storeIssue({
        repositoryId,
        issueNumber: 123,
        title: 'Test Issue',
        body: 'This is a test issue',
        labels: ['bug', 'high-priority'],
        issueUrl: 'https://github.com/owner/repo/issues/123',
        attemptCount: 0,
        status: 'pending',
      });

      expect(issueId).toBeGreaterThan(0);

      const issue = database.getIssue(issueId);
      expect(issue).not.toBeNull();
      expect(issue?.title).toBe('Test Issue');
      expect(issue?.labels).toEqual(['bug', 'high-priority']);
      expect(issue?.status).toBe('pending');
    });
  });

  describe('Queue Management', () => {
    let repositoryId: number;
    let issueId: number;

    beforeEach(() => {
      repositoryId = database.addRepository('owner', 'repo', {
        dailyAttemptLimit: 3,
        dailyPRLimit: 2,
        scoreThreshold: 70,
      });

      issueId = database.storeIssue({
        repositoryId,
        issueNumber: 123,
        title: 'Test Issue',
        body: 'This is a test issue',
        labels: ['bug'],
        issueUrl: 'https://github.com/owner/repo/issues/123',
        attemptCount: 0,
        status: 'pending',
      });
    });

    it('should add items to queue', () => {
      const queueId = database.addToQueue(issueId, 'test-user', 5);
      expect(queueId).toBeGreaterThan(0);

      const queue = database.getQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({
        id: queueId,
        issueId,
        priority: 5,
        status: 'pending',
        requestedBy: 'test-user',
      });
    });

    it('should get next queue item by priority', () => {
      // Add multiple items with different priorities
      database.addToQueue(issueId, 'user1', 1);
      database.addToQueue(issueId, 'user2', 10);
      database.addToQueue(issueId, 'user3', 5);

      const nextItem = database.getNextQueueItem();
      expect(nextItem).not.toBeNull();
      expect(nextItem?.priority).toBe(10); // Highest priority
      expect(nextItem?.requestedBy).toBe('user2');
    });

    it('should update queue item status', () => {
      const queueId = database.addToQueue(issueId, 'test-user', 5);

      database.updateQueueItemStatus(queueId, 'processing');

      const queue = database.getQueue();
      expect(queue[0].status).toBe('processing');
    });
  });

  describe('Activity Logging', () => {
    it('should log and retrieve activities', () => {
      database.logActivity('info', 'test', 'Test message', { key: 'value' });

      const activities = database.getRecentActivity(10);
      expect(activities).toHaveLength(1);
      expect(activities[0]).toMatchObject({
        level: 'info',
        category: 'test',
        message: 'Test message',
      });
      expect(activities[0].metadata).toEqual({ key: 'value' });
    });

    it('should limit recent activities', () => {
      // Add multiple activities
      for (let i = 0; i < 15; i++) {
        database.logActivity('info', 'test', `Message ${i}`);
      }

      const activities = database.getRecentActivity(10);
      expect(activities).toHaveLength(10);
    });
  });

  describe('Statistics', () => {
    it('should track daily stats', () => {
      const today = new Date();
      const stats = database.getDailyStats(today);

      expect(stats).toMatchObject({
        totalAttempts: 0,
        totalPrs: 0,
        totalCostUsd: 0,
        successfulAttempts: 0,
        failedAttempts: 0,
      });
    });

    it('should get queue statistics', () => {
      const repositoryId = database.addRepository('owner', 'repo', {
        dailyAttemptLimit: 3,
        dailyPRLimit: 2,
        scoreThreshold: 70,
      });

      const issueId = database.storeIssue({
        repositoryId,
        issueNumber: 123,
        title: 'Test Issue',
        body: 'Test',
        labels: [],
        issueUrl: 'https://github.com/owner/repo/issues/123',
        attemptCount: 0,
        status: 'pending',
      });

      // Add items with different statuses
      database.addToQueue(issueId, 'user1', 1);
      const queueId2 = database.addToQueue(issueId, 'user2', 2);
      database.updateQueueItemStatus(queueId2, 'completed');

      const stats = database.getQueueStats();
      expect(stats.pending).toBe(1);
      expect(stats.completed).toBe(1);
      expect(stats.processing).toBe(0);
    });
  });
});
