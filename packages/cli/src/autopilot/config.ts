/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';
import { homedir } from 'os';
import { AutopilotSettings } from './types.js';
import { SETTINGS_DIRECTORY_NAME } from '../config/settings.js';

export function getDefaultAutopilotSettings(): AutopilotSettings {
  const autopilotDir = path.join(
    homedir(),
    SETTINGS_DIRECTORY_NAME,
    'autopilot',
  );

  return {
    enabled: false,
    dailyLimits: {
      totalAttempts: 10,
      totalPRs: 5,
      totalCostUSD: 50.0,
    },
    repositoryLimits: {
      attemptsPerRepo: 3,
      prsPerRepo: 2,
    },
    scanning: {
      intervalMinutes: 15,
      issueScoreThreshold: 70,
    },
    safety: {
      requireTests: true,
      maxWorkspaceSize: '1GB',
      timeoutMinutes: 30,
    },
    ai: {
      useGeminiForClassification: true,
      fallbackClassification: true,
    },
    workspaceBase: path.join(autopilotDir, 'workspaces'),
    databasePath: path.join(autopilotDir, 'autopilot.db'),
  };
}

export function mergeAutopilotSettings(
  base: AutopilotSettings,
  overrides: Partial<AutopilotSettings>,
): AutopilotSettings {
  return {
    ...base,
    ...overrides,
    dailyLimits: {
      ...base.dailyLimits,
      ...overrides.dailyLimits,
    },
    repositoryLimits: {
      ...base.repositoryLimits,
      ...overrides.repositoryLimits,
    },
    scanning: {
      ...base.scanning,
      ...overrides.scanning,
    },
    safety: {
      ...base.safety,
      ...overrides.safety,
    },
    ai: {
      ...base.ai,
      ...overrides.ai,
    },
  };
}
