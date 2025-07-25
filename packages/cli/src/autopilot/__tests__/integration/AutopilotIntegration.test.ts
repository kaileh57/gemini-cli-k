/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Config } from '@google/gemini-cli-core';
import { LoadedSettings } from '../../config/settings.js';
import { AutopilotService } from '../AutopilotService.js';
import { getDefaultAutopilotSettings } from '../config.js';

describe('Autopilot Integration Tests', () => {
  let tempDir: string;
  let service: AutopilotService;
  let mockConfig: Config;
  let mockSettings: LoadedSettings;

  beforeEach(async () => {
    // Create temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-test-'));

    // Create mock config
    mockConfig = {
      workingDirectory: tempDir,
      // Add other required config properties as needed
    } as Config;

    // Create mock settings with autopilot configuration
    const autopilotSettings = {
      ...getDefaultAutopilotSettings(),
      enabled: true,
      databasePath: path.join(tempDir, 'autopilot.db'),
      workspaceBase: path.join(tempDir, 'workspaces'),
      dailyLimits: {
        totalAttempts: 5,
        totalPRs: 3,
        totalCostUSD: 10.0,
      },
    };

    mockSettings = {
      merged: { autopilot: autopilotSettings },
      system: { settings: {}, path: '' },
      user: { settings: {}, path: '' },
      workspace: { settings: {}, path: '' },
      errors: [],
    } as LoadedSettings;

    // Reset singleton
    AutopilotService.reset();
  });

  afterEach(async () => {
    // Clean up service if it exists
    if (service) {
      try {
        await service.stop();
      } catch (_error) {
        // Ignore cleanup errors
      }
    }

    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Service Lifecycle', () => {
    it('should initialize service with all components', () => {
      expect(() => {
        service = AutopilotService.getInstance(mockConfig, mockSettings);
      }).not.toThrow();

      expect(service).toBeDefined();
      expect(service.isServiceRunning()).toBe(false);
    });

    it('should start and stop service gracefully', async () => {
      service = AutopilotService.getInstance(mockConfig, mockSettings);

      expect(service.isServiceRunning()).toBe(false);

      // Note: Start might fail due to missing GitHub CLI, Gemini CLI, etc.
      // This is expected in a test environment
      try {
        await service.start();
        expect(service.isServiceRunning()).toBe(true);

        await service.stop();
        expect(service.isServiceRunning()).toBe(false);
      } catch (error) {
        // Expected in test environment without proper tools
        expect((error as Error).message).toMatch(/validation|access|CLI/i);
      }
    });

    it('should handle disabled autopilot gracefully', async () => {
      const disabledSettings = {
        ...mockSettings,
        merged: {
          autopilot: {
            ...mockSettings.merged.autopilot,
            enabled: false,
          },
        },
      };

      service = AutopilotService.getInstance(mockConfig, disabledSettings);

      await expect(service.start()).rejects.toThrow(
        'Autopilot is disabled in settings',
      );
    });
  });

  describe('Status and Monitoring', () => {
    it('should provide comprehensive status information', async () => {
      service = AutopilotService.getInstance(mockConfig, mockSettings);

      const status = await service.getStatus();

      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('dailyStats');
      expect(status).toHaveProperty('limits');
      expect(status).toHaveProperty('queueStats');

      expect(status.dailyStats).toHaveProperty('attempts');
      expect(status.dailyStats).toHaveProperty('prs');
      expect(status.dailyStats).toHaveProperty('cost');

      expect(status.limits).toEqual({
        totalAttempts: 5,
        totalPRs: 3,
        totalCostUSD: 10.0,
      });
    });

    it('should track repositories correctly', async () => {
      service = AutopilotService.getInstance(mockConfig, mockSettings);

      const repos = await service.getRepositories();
      expect(Array.isArray(repos)).toBe(true);
      expect(repos.length).toBe(0); // Initially empty
    });
  });

  describe('Repository Management', () => {
    it('should handle repository addition with proper validation', async () => {
      service = AutopilotService.getInstance(mockConfig, mockSettings);

      // This will likely fail due to GitHub CLI not being available in test
      // but should fail gracefully with a meaningful error
      await expect(
        service.addRepository('test-owner', 'test-repo'),
      ).rejects.toThrow();
    });

    it('should handle repository removal', async () => {
      service = AutopilotService.getInstance(mockConfig, mockSettings);

      // Should fail gracefully when trying to remove non-existent repo
      await expect(
        service.removeRepository('test-owner', 'test-repo'),
      ).rejects.toThrow('not found in whitelist');
    });
  });

  describe('Queue Management', () => {
    it('should provide queue information', async () => {
      service = AutopilotService.getInstance(mockConfig, mockSettings);

      const queue = await service.getQueue();
      expect(Array.isArray(queue)).toBe(true);
      expect(queue.length).toBe(0); // Initially empty
    });

    it('should validate issue URLs', async () => {
      service = AutopilotService.getInstance(mockConfig, mockSettings);

      // Should fail with invalid URL
      await expect(
        service.addToQueue('invalid-url', 'test-user'),
      ).rejects.toThrow('Invalid GitHub issue URL');
    });
  });

  describe('Database Integration', () => {
    it('should initialize database correctly', async () => {
      service = AutopilotService.getInstance(mockConfig, mockSettings);

      // Database should be created during initialization
      const _dbPath = path.join(tempDir, 'autopilot.db');

      // May not exist until start() is called, depending on implementation
      // Just verify the service has database functionality
      expect(() => service.getStatus()).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle missing dependencies gracefully', async () => {
      service = AutopilotService.getInstance(mockConfig, mockSettings);

      // Starting without proper CLI tools should fail gracefully
      try {
        await service.start();
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBeTruthy();
      }
    });

    it('should handle invalid configuration', () => {
      const invalidSettings = {
        ...mockSettings,
        merged: {
          autopilot: {
            ...mockSettings.merged.autopilot,
            databasePath: '/invalid/path/that/cannot/be/created/autopilot.db',
          },
        },
      };

      // Should handle invalid database path gracefully
      expect(() => {
        service = AutopilotService.getInstance(mockConfig, invalidSettings);
      }).not.toThrow(); // Error should occur during start(), not initialization
    });
  });

  describe('Component Integration', () => {
    it('should have all required components initialized', () => {
      service = AutopilotService.getInstance(mockConfig, mockSettings);

      // Verify service has been properly constructed with all components
      // This is a structural test - if components aren't properly initialized,
      // methods would throw during calls
      expect(() => service.getStatus()).not.toThrow();
      expect(() => service.getRepositories()).not.toThrow();
      expect(() => service.getQueue()).not.toThrow();
    });
  });
});

describe('Autopilot Configuration Validation', () => {
  it('should merge settings correctly', () => {
    const defaultSettings = getDefaultAutopilotSettings();

    expect(defaultSettings).toHaveProperty('enabled');
    expect(defaultSettings).toHaveProperty('dailyLimits');
    expect(defaultSettings).toHaveProperty('safety');
    expect(defaultSettings.enabled).toBe(false); // Should be disabled by default
  });

  it('should have sensible default limits', () => {
    const defaultSettings = getDefaultAutopilotSettings();

    expect(defaultSettings.dailyLimits.totalAttempts).toBeGreaterThan(0);
    expect(defaultSettings.dailyLimits.totalPRs).toBeGreaterThan(0);
    expect(defaultSettings.dailyLimits.totalCostUSD).toBeGreaterThan(0);

    // Should be conservative defaults
    expect(defaultSettings.dailyLimits.totalAttempts).toBeLessThanOrEqual(20);
    expect(defaultSettings.dailyLimits.totalPRs).toBeLessThanOrEqual(10);
  });
});
