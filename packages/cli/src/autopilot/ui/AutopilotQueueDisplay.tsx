/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../ui/colors.js';

interface QueueItem {
  id: number;
  issueId: number;
  priority: number;
  status: string;
  requestedBy: string;
  requestedAt: string;
  repoOwner?: string;
  repoName?: string;
  title?: string;
}

interface AutopilotQueueDisplayProps {
  queue: QueueItem[];
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'pending':
      return '⏳';
    case 'processing':
      return '🔄';
    case 'completed':
      return '✅';
    case 'failed':
      return '❌';
    case 'cancelled':
      return '🚫';
    default:
      return '❓';
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'pending':
      return Colors.AccentYellow;
    case 'processing':
      return Colors.AccentBlue;
    case 'completed':
      return Colors.AccentGreen;
    case 'failed':
      return Colors.AccentRed;
    case 'cancelled':
      return Colors.Gray;
    default:
      return Colors.Foreground;
  }
}

export const AutopilotQueueDisplay: React.FC<AutopilotQueueDisplayProps> = ({
  queue,
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
        📋 Manual Queue
      </Text>
    </Box>

    {queue.length === 0 ? (
      <Box flexDirection="column">
        <Text color={Colors.Gray}>Queue is empty.</Text>
        <Box marginTop={1}>
          <Text>
            Use{' '}
            <Text color={Colors.AccentBlue}>
              /autopilot queue add &lt;issue-url&gt;
            </Text>{' '}
            to add issues.
          </Text>
        </Box>
      </Box>
    ) : (
      <Box flexDirection="column">
        {/* Header */}
        <Box marginBottom={1}>
          <Box width="6%">
            <Text bold color={Colors.LightBlue}>
              ID
            </Text>
          </Box>
          <Box width="30%">
            <Text bold color={Colors.LightBlue}>
              Issue
            </Text>
          </Box>
          <Box width="20%">
            <Text bold color={Colors.LightBlue}>
              Status
            </Text>
          </Box>
          <Box width="15%">
            <Text bold color={Colors.LightBlue}>
              Priority
            </Text>
          </Box>
          <Box width="29%">
            <Text bold color={Colors.LightBlue}>
              Requested By
            </Text>
          </Box>
        </Box>

        {/* Divider */}
        <Box marginBottom={1}>
          <Text color={Colors.Gray}>{'─'.repeat(80)}</Text>
        </Box>

        {/* Items */}
        {queue.map((item) => {
          const issueRef =
            item.repoOwner && item.repoName
              ? `${item.repoOwner}/${item.repoName}#${item.issueId}`
              : `Issue #${item.issueId}`;
          const truncatedRef =
            issueRef.length > 25 ? issueRef.substring(0, 22) + '...' : issueRef;

          return (
            <Box key={item.id} marginBottom={1}>
              <Box width="6%">
                <Text>{item.id}</Text>
              </Box>
              <Box width="30%">
                <Text>{truncatedRef}</Text>
              </Box>
              <Box width="20%">
                <Text color={getStatusColor(item.status)}>
                  {getStatusIcon(item.status)} {item.status}
                </Text>
              </Box>
              <Box width="15%">
                <Text>{item.priority}</Text>
              </Box>
              <Box width="29%">
                <Text color={Colors.Gray}>{item.requestedBy}</Text>
              </Box>
            </Box>
          );
        })}

        <Box marginTop={1} paddingTop={1} borderTop={true} borderStyle="round">
          <Box flexDirection="column">
            <Text color={Colors.Gray}>Commands:</Text>
            <Text>
              {' '}
              <Text color={Colors.AccentBlue}>
                /autopilot queue add &lt;issue-url&gt;
              </Text>{' '}
              Add issue to queue
            </Text>
            <Text>
              {' '}
              <Text color={Colors.AccentBlue}>/autopilot queue list</Text> Show
              current queue
            </Text>
          </Box>
        </Box>
      </Box>
    )}
  </Box>
);
