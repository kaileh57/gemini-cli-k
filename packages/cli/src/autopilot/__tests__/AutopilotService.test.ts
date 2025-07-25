/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AutopilotService } from '../AutopilotService.js';
import { Config } from '@google/gemini-cli-core';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

// Mock config for testing
function createMockConfig(): Config {
  const tempDir = path.join(tmpdir(), 'autopilot-test-' + Date.now());

  return {
    getLoadedSettings: () => ({
      merged: {
        autopilot: {
          enabled: true,
          dailyLimits: {
            totalAttempts: 5,
            totalPRs: 3,
            totalCostUSD: 25.0,
          },
          repositoryLimits: {
            attemptsPerRepo: 2,
            prsPerRepo: 1,
          },
          scanning: {
            intervalMinutes: 5,
            issueScoreThreshold: 60,
          },
          safety: {
            requireTests: false,
            maxWorkspaceSize: '100MB',
            timeoutMinutes: 10,
          },
          ai: {
            useGeminiForClassification: false,
            fallbackClassification: true,
          },
          workspaceBase: path.join(tempDir, 'workspaces'),
          databasePath: path.join(tempDir, 'test.db'),
        },
      },
    }),
  } as LoadedSettings;
}

describe('AutopilotService', () => {
  let service: AutopilotService;
  let mockConfig: Config;
  let tempDir: string;

  beforeEach(() => {
    // Reset singleton
    AutopilotService.reset();

    mockConfig = createMockConfig();
    tempDir =
      mockConfig.getLoadedSettings()?.merged?.autopilot?.workspaceBase || '';

    // Create temp directory
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    service = AutopilotService.getInstance(mockConfig);
  });

  afterEach(async () => {
    try {
      await service.stop();
    } catch {
      // Ignore errors during cleanup
    }

    // Cleanup temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    AutopilotService.reset();
  });

  describe('Service Lifecycle', () => {
    it('should initialize correctly', () => {
      expect(service).toBeDefined();
      expect(service.isServiceRunning()).toBe(false);
    });

    it('should handle start with disabled setting', async () => {
      // Create a config with autopilot disabled
      const disabledConfig = {
        ...mockConfig,
        getLoadedSettings: () => ({
          merged: {
            autopilot: {
              ...mockConfig.getLoadedSettings()?.merged?.autopilot,
              enabled: false,
            },
          },
        }),
      } as Config;

      AutopilotService.reset();
      const disabledService = AutopilotService.getInstance(disabledConfig);

      await expect(disabledService.start()).rejects.toThrow(
        'Autopilot is disabled in settings',
      );
    });

    it('should prevent double start', async () => {
      // Mock the safety validation to avoid external dependencies
      vi.spyOn(
        service as unknown as Record<string, unknown>,
        'safetyController',
        'get',
      ).mockReturnValue({
        validateSetup: vi.fn().mockResolvedValue(undefined),
      });

      await service.start();
      expect(service.isServiceRunning()).toBe(true);

      await expect(service.start()).rejects.toThrow(
        'Autopilot is already running',
      );
    });
  });

  describe('Status and Configuration', () => {
    it('should return correct status when stopped', async () => {
      const status = await service.getStatus();

      expect(status.isRunning).toBe(false);
      expect(status.nextScan).toBeUndefined();
      expect(status.dailyStats).toEqual({
        attempts: 0,
        prs: 0,
        cost: 0,
      });
      expect(status.limits).toEqual({
        totalAttempts: 5,
        totalPRs: 3,
        totalCostUSD: 25.0,
      });
    });

    it('should track repositories', async () => {
      const initialRepos = await service.getRepositories();
      expect(initialRepos).toHaveLength(0);
    });

    it('should track queue', async () => {
      const initialQueue = await service.getQueue();
      expect(initialQueue).toHaveLength(0);
    });
  });

  describe('Repository Management', () => {
    it('should validate repository format', async () => {
      // Mock GitHubClient to simulate repository access check
      vi.spyOn(
        service as unknown as Record<string, unknown>,
        'gitHubClient',
        'get',
      ).mockReturnValue({
        checkRepositoryAccess: vi.fn().mockResolvedValue(false),
      });

      await expect(service.addRepository('invalid', 'repo')).rejects.toThrow(
        'Cannot access repository invalid/repo',
      );
    });
  });
});

describe('AutopilotService Singleton', () => {
  it('should maintain singleton pattern', () => {
    const mockConfig = createMockConfig();

    const service1 = AutopilotService.getInstance(mockConfig);
    const service2 = AutopilotService.getInstance();

    expect(service1).toBe(service2);

    AutopilotService.reset();
  });

  it('should require config for first initialization', () => {
    AutopilotService.reset();

    expect(() => AutopilotService.getInstance()).toThrow(
      'Config required for first initialization',
    );
  });
});
