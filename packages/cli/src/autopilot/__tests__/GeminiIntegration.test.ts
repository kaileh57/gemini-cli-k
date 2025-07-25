/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GeminiIntegration } from '../ai/GeminiIntegration.js';
import { Config } from '@google/gemini-cli-core';
import { AutopilotDatabase } from '../storage/Database.js';
import { GitHubIssue } from '../types.js';

// Mock the dependencies
vi.mock('@google/gemini-cli-core', () => ({
  Config: vi.fn(),
  executeToolCall: vi.fn(),
}));

vi.mock('../../nonInteractiveCli.js', () => ({
  runNonInteractive: vi.fn(),
}));

describe('GeminiIntegration', () => {
  let geminiIntegration: GeminiIntegration;
  let mockConfig: Config;
  let mockDatabase: AutopilotDatabase;

  beforeEach(() => {
    // Create mock config
    mockConfig = {
      getGeminiClient: vi.fn().mockReturnValue({
        getChat: vi.fn().mockResolvedValue({
          sendMessage: vi.fn().mockResolvedValue({
            candidates: [
              {
                content: {
                  parts: [{ text: 'Test response' }],
                },
              },
            ],
          }),
          sendMessageStream: vi.fn().mockResolvedValue([
            {
              candidates: [
                {
                  content: {
                    parts: [{ text: 'Streaming response' }],
                  },
                },
              ],
            },
          ]),
        }),
      }),
      getToolRegistry: vi.fn().mockResolvedValue({
        getFunctionDeclarations: vi.fn().mockReturnValue([]),
      }),
    } as Config;

    // Create mock database
    mockDatabase = {
      logActivity: vi.fn(),
      initialize: vi.fn(),
    } as Config;

    geminiIntegration = new GeminiIntegration(mockConfig, mockDatabase);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize tool registry successfully', async () => {
      await geminiIntegration.initialize();
      expect(mockConfig.getToolRegistry).toHaveBeenCalled();
    });
  });

  describe('Issue Classification Integration', () => {
    it('should create proper solution prompt', () => {
      const mockIssue: GitHubIssue = {
        id: 1,
        repositoryId: 1,
        issueNumber: 123,
        title: 'Fix typo in README',
        body: 'There is a typo in the README file',
        labels: ['documentation', 'good first issue'],
        issueUrl: 'https://github.com/test/repo/issues/123',
        attemptCount: 0,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Access the private method through type assertion for testing
      const integration = geminiIntegration as unknown as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      const prompt = integration.createSolutionPrompt(
        mockIssue,
        'test',
        'repo',
        '/workspace',
      );

      expect(prompt).toContain('Fix typo in README');
      expect(prompt).toContain('documentation, good first issue');
      expect(prompt).toContain('Issue #123');
      expect(prompt).toContain('Gemini Autopilot');
    });
  });

  describe('Complexity Assessment', () => {
    it('should correctly identify low complexity issues', () => {
      const mockIssue: GitHubIssue = {
        id: 1,
        repositoryId: 1,
        issueNumber: 123,
        title: 'Fix typo in documentation',
        body: 'Simple typo fix needed',
        labels: ['good first issue'],
        issueUrl: 'https://github.com/test/repo/issues/123',
        attemptCount: 0,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const integration = geminiIntegration as unknown as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      const complexity = integration.getComplexityIndicator(mockIssue);

      expect(complexity).toBe('Low - Good first issue');
    });

    it('should correctly identify high complexity security issues', () => {
      const mockIssue: GitHubIssue = {
        id: 1,
        repositoryId: 1,
        issueNumber: 456,
        title: 'Security vulnerability in authentication',
        body: 'Critical security issue needs fixing',
        labels: ['security'],
        issueUrl: 'https://github.com/test/repo/issues/456',
        attemptCount: 0,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const integration = geminiIntegration as unknown as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      const complexity = integration.getComplexityIndicator(mockIssue);

      expect(complexity).toBe('High - Security related');
    });
  });

  describe('Gemini Access Validation', () => {
    it('should validate Gemini access successfully', async () => {
      const result = await geminiIntegration.validateGeminiAccess();
      expect(result).toBe(true);
      expect(mockConfig.getGeminiClient).toHaveBeenCalled();
    });

    it('should handle validation failures gracefully', async () => {
      // Mock failure
      mockConfig.getGeminiClient = vi.fn().mockReturnValue({
        getChat: vi.fn().mockRejectedValue(new Error('Connection failed')),
      });

      const result = await geminiIntegration.validateGeminiAccess();
      expect(result).toBe(false);
      expect(mockDatabase.logActivity).toHaveBeenCalledWith(
        'error',
        'validation',
        expect.stringContaining('Gemini access validation failed'),
      );
    });
  });

  describe('File Operation Detection', () => {
    it('should correctly identify file operations', () => {
      const integration = geminiIntegration as unknown as Record<
        string,
        (...args: unknown[]) => unknown
      >;

      expect(integration.isFileOperation('read_file')).toBe(true);
      expect(integration.isFileOperation('edit_file')).toBe(true);
      expect(integration.isFileOperation('write_file')).toBe(true);
      expect(integration.isFileOperation('glob')).toBe(true);
      expect(integration.isFileOperation('grep')).toBe(true);
      expect(integration.isFileOperation('run_shell_command')).toBe(false);
    });
  });

  describe('Cost Estimation', () => {
    it('should provide reasonable cost estimates', () => {
      const integration = geminiIntegration as unknown as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      const cost = integration.estimateCost('test prompt', 30);

      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThan(1); // Should be reasonably small for test input
    });
  });
});
