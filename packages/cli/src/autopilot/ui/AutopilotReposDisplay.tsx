/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../ui/colors.js';

interface Repository {
  id: number;
  owner: string;
  name: string;
  enabled: boolean;
  dailyAttemptLimit: number;
  dailyPRLimit: number;
  scoreThreshold: number;
  todayAttempts: number;
  todayPRs: number;
}

interface AutopilotReposDisplayProps {
  repositories: Repository[];
}

export const AutopilotReposDisplay: React.FC<AutopilotReposDisplayProps> = ({
  repositories,
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
        📂 Whitelisted Repositories
      </Text>
    </Box>

    {repositories.length === 0 ? (
      <Box flexDirection="column">
        <Text color={Colors.Gray}>No repositories configured.</Text>
        <Box marginTop={1}>
          <Text>
            Use{' '}
            <Text color={Colors.AccentBlue}>
              /autopilot repos add owner/name
            </Text>{' '}
            to add repositories.
          </Text>
        </Box>
      </Box>
    ) : (
      <Box flexDirection="column">
        {repositories.map((repo, index) => (
          <Box
            key={`${repo.owner}/${repo.name}`}
            marginBottom={index < repositories.length - 1 ? 1 : 0}
          >
            <Box flexDirection="column">
              <Box flexDirection="row">
                <Box width="5%">
                  <Text
                    color={repo.enabled ? Colors.AccentGreen : Colors.AccentRed}
                  >
                    {repo.enabled ? '✓' : '✗'}
                  </Text>
                </Box>
                <Box width="40%">
                  <Text bold>
                    {repo.owner}/{repo.name}
                  </Text>
                </Box>
                <Box>
                  <Text
                    color={repo.enabled ? Colors.AccentGreen : Colors.AccentRed}
                  >
                    {repo.enabled ? '🟢' : '🔴'}
                  </Text>
                </Box>
              </Box>
              <Box flexDirection="row" paddingLeft={2}>
                <Box width="25%">
                  <Text color={Colors.LightBlue}>Daily Stats:</Text>
                </Box>
                <Box>
                  <Text>
                    {repo.todayAttempts}/{repo.dailyAttemptLimit} attempts,
                    {repo.todayPRs}/{repo.dailyPRLimit} PRs
                  </Text>
                </Box>
              </Box>
              <Box flexDirection="row" paddingLeft={2}>
                <Box width="25%">
                  <Text color={Colors.LightBlue}>Score threshold:</Text>
                </Box>
                <Box>
                  <Text>{repo.scoreThreshold}</Text>
                </Box>
              </Box>
            </Box>
          </Box>
        ))}

        <Box marginTop={1} paddingTop={1} borderTop={true} borderStyle="round">
          <Box flexDirection="column">
            <Text color={Colors.Gray}>Commands:</Text>
            <Text>
              {' '}
              <Text color={Colors.AccentBlue}>
                /autopilot repos add owner/name
              </Text>{' '}
              Add repository
            </Text>
            <Text>
              {' '}
              <Text color={Colors.AccentBlue}>
                /autopilot repos remove owner/name
              </Text>{' '}
              Remove repository
            </Text>
          </Box>
        </Box>
      </Box>
    )}
  </Box>
);
