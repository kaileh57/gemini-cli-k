/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../ui/colors.js';

interface AutopilotStatusDisplayProps {
  isRunning: boolean;
  nextScan?: string;
  dailyStats: {
    attempts: number;
    prs: number;
    cost: number;
  };
  limits: {
    totalAttempts: number;
    totalPRs: number;
    totalCostUSD: number;
  };
  queueStats: {
    pending: number;
    processing: number;
    completed: number;
  };
  currentActivity?: {
    description: string;
    startTime: string;
  };
}

const formatTime = (timeString?: string): string => {
  if (!timeString) return '';
  try {
    return new Date(timeString).toLocaleTimeString();
  } catch {
    return timeString;
  }
};

export const AutopilotStatusDisplay: React.FC<AutopilotStatusDisplayProps> = ({
  isRunning,
  nextScan,
  dailyStats,
  limits,
  queueStats,
  currentActivity,
}) => (
  <Box
    borderStyle="round"
    borderColor="gray"
    flexDirection="column"
    padding={1}
    marginY={1}
  >
    <Box marginBottom={1}>
      <Text bold color={Colors.AccentPurple}>
        🤖 Autopilot Status
      </Text>
    </Box>

    <Box flexDirection="row" marginBottom={1}>
      <Box width="20%">
        <Text bold color={Colors.LightBlue}>
          Status
        </Text>
      </Box>
      <Box>
        <Text color={isRunning ? Colors.AccentGreen : Colors.AccentRed}>
          {isRunning ? '🟢 Running' : '🔴 Stopped'}
        </Text>
      </Box>
    </Box>

    {isRunning && nextScan && (
      <Box flexDirection="row" marginBottom={1}>
        <Box width="20%">
          <Text bold color={Colors.LightBlue}>
            Next Scan
          </Text>
        </Box>
        <Box>
          <Text>{formatTime(nextScan)}</Text>
        </Box>
      </Box>
    )}

    <Box marginBottom={1}>
      <Text bold color={Colors.AccentBlue}>
        Daily Limits
      </Text>
    </Box>

    <Box flexDirection="row">
      <Box width="20%">
        <Text bold color={Colors.LightBlue}>
          Attempts
        </Text>
      </Box>
      <Box>
        <Text
          color={
            dailyStats.attempts >= limits.totalAttempts
              ? Colors.AccentRed
              : Colors.AccentYellow
          }
        >
          {dailyStats.attempts}/{limits.totalAttempts}
        </Text>
      </Box>
    </Box>

    <Box flexDirection="row">
      <Box width="20%">
        <Text bold color={Colors.LightBlue}>
          PRs
        </Text>
      </Box>
      <Box>
        <Text
          color={
            dailyStats.prs >= limits.totalPRs
              ? Colors.AccentRed
              : Colors.AccentYellow
          }
        >
          {dailyStats.prs}/{limits.totalPRs}
        </Text>
      </Box>
    </Box>

    <Box flexDirection="row" marginBottom={1}>
      <Box width="20%">
        <Text bold color={Colors.LightBlue}>
          Cost
        </Text>
      </Box>
      <Box>
        <Text
          color={
            dailyStats.cost >= limits.totalCostUSD
              ? Colors.AccentRed
              : Colors.AccentYellow
          }
        >
          ${dailyStats.cost.toFixed(2)}/${limits.totalCostUSD.toFixed(2)}
        </Text>
      </Box>
    </Box>

    <Box marginBottom={1}>
      <Text bold color={Colors.AccentCyan}>
        Queue Status
      </Text>
    </Box>

    <Box flexDirection="row">
      <Box width="20%">
        <Text bold color={Colors.LightBlue}>
          Pending
        </Text>
      </Box>
      <Box width="15%">
        <Text color={Colors.AccentYellow}>{queueStats.pending}</Text>
      </Box>
      <Box width="20%">
        <Text bold color={Colors.LightBlue}>
          Processing
        </Text>
      </Box>
      <Box width="15%">
        <Text color={Colors.AccentBlue}>{queueStats.processing}</Text>
      </Box>
      <Box width="20%">
        <Text bold color={Colors.LightBlue}>
          Completed
        </Text>
      </Box>
      <Box>
        <Text color={Colors.AccentGreen}>{queueStats.completed}</Text>
      </Box>
    </Box>

    {currentActivity && (
      <Box marginTop={1}>
        <Box marginBottom={1}>
          <Text bold color={Colors.AccentPurple}>
            Current Activity
          </Text>
        </Box>
        <Box flexDirection="row">
          <Box width="20%">
            <Text bold color={Colors.LightBlue}>
              Task
            </Text>
          </Box>
          <Box>
            <Text>{currentActivity.description}</Text>
          </Box>
        </Box>
        <Box flexDirection="row">
          <Box width="20%">
            <Text bold color={Colors.LightBlue}>
              Started
            </Text>
          </Box>
          <Box>
            <Text color={Colors.Gray}>
              {formatTime(currentActivity.startTime)}
            </Text>
          </Box>
        </Box>
      </Box>
    )}
  </Box>
);
