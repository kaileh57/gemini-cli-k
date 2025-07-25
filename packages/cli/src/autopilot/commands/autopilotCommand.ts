/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SlashCommand,
  SlashCommandActionReturn,
  CommandContext,
} from '../../ui/commands/types.js';
import { MessageType, HistoryItem } from '../../ui/types.js';
import { AutopilotService } from '../AutopilotService.js';

async function startAutopilot(
  context: CommandContext,
): Promise<SlashCommandActionReturn | void> {
  try {
    if (!context.services.config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Configuration not available',
      };
    }

    const service = AutopilotService.getInstance(
      context.services.config,
      context.services.settings,
    );

    if (service.isServiceRunning()) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'Autopilot is already running',
      };
    }

    await service.start();

    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: '🤖 Autopilot service started successfully',
      },
      Date.now(),
    );
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to start autopilot: ${(error as Error).message}`,
    };
  }
}

async function stopAutopilot(
  context: CommandContext,
): Promise<SlashCommandActionReturn | void> {
  try {
    if (!context.services.config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Configuration not available',
      };
    }

    const service = AutopilotService.getInstance(
      context.services.config,
      context.services.settings,
    );
    await service.stop();

    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: '🛑 Autopilot service stopped',
      },
      Date.now(),
    );
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to stop autopilot: ${(error as Error).message}`,
    };
  }
}

async function addRepository(
  repoSpec: string,
  context: CommandContext,
): Promise<SlashCommandActionReturn | void> {
  if (!repoSpec || !repoSpec.includes('/')) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Usage: /autopilot repos add <owner/repo>',
    };
  }

  try {
    if (!context.services.config || !context.services.settings) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Configuration not available',
      };
    }

    const [owner, repo] = repoSpec.split('/');
    const service = AutopilotService.getInstance(
      context.services.config,
      context.services.settings,
    );

    await service.addRepository(owner, repo);

    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: `✅ Added repository ${owner}/${repo} to autopilot whitelist`,
      },
      Date.now(),
    );
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to add repository: ${(error as Error).message}`,
    };
  }
}

async function removeRepository(
  repoSpec: string,
  context: CommandContext,
): Promise<SlashCommandActionReturn | void> {
  if (!repoSpec || !repoSpec.includes('/')) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Usage: /autopilot repos remove <owner/repo>',
    };
  }

  try {
    if (!context.services.config || !context.services.settings) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Configuration not available',
      };
    }

    const [owner, repo] = repoSpec.split('/');
    const service = AutopilotService.getInstance(
      context.services.config,
      context.services.settings,
    );

    await service.removeRepository(owner, repo);

    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: `🗑️ Removed repository ${owner}/${repo} from autopilot whitelist`,
      },
      Date.now(),
    );
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to remove repository: ${(error as Error).message}`,
    };
  }
}

async function addToQueue(
  issueUrl: string,
  context: CommandContext,
): Promise<SlashCommandActionReturn | void> {
  if (!issueUrl) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Usage: /autopilot queue add <issue-url>',
    };
  }

  try {
    if (!context.services.config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Configuration not available',
      };
    }

    const service = AutopilotService.getInstance(
      context.services.config,
      context.services.settings,
    );
    await service.addToQueue(issueUrl, 'manual', 10); // Higher priority for manual additions

    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: `📝 Added issue to autopilot queue: ${issueUrl}`,
      },
      Date.now(),
    );
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to add to queue: ${(error as Error).message}`,
    };
  }
}

export const autopilotCommand: SlashCommand = {
  name: 'autopilot',
  description: 'Manage the autonomous coding agent',
  subCommands: [
    {
      name: 'start',
      description: 'Start autopilot service',
      action: startAutopilot,
    },
    {
      name: 'stop',
      description: 'Stop autopilot service',
      action: stopAutopilot,
    },
    {
      name: 'status',
      description: 'Show autopilot status and dashboard',
      action: async (context: CommandContext) => {
        try {
          if (!context.services.config) {
            return {
              type: 'message',
              messageType: 'error',
              content: 'Configuration not available',
            };
          }

          const service = AutopilotService.getInstance(
            context.services.config,
            context.services.settings,
          );
          const status = await service.getStatus();

          context.ui.addItem(
            {
              type: 'autopilot_status' as const,
              ...status,
            },
            Date.now(),
          );
        } catch (error) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed to get status: ${(error as Error).message}`,
          };
        }
      },
    },
    {
      name: 'repos',
      description: 'Manage repository whitelist',
      subCommands: [
        {
          name: 'add',
          description: 'Add repository to whitelist',
          action: async (context, args) => {
            const repoSpec = args.trim();
            return await addRepository(repoSpec, context);
          },
        },
        {
          name: 'remove',
          description: 'Remove repository from whitelist',
          action: async (context, args) => {
            const repoSpec = args.trim();
            return await removeRepository(repoSpec, context);
          },
        },
        {
          name: 'list',
          description: 'List whitelisted repositories',
          action: async (context: CommandContext) => {
            try {
              if (!context.services.config) {
                return {
                  type: 'message',
                  messageType: 'error',
                  content: 'Configuration not available',
                };
              }

              const service = AutopilotService.getInstance(
                context.services.config,
                context.services.settings,
              );
              const repos = await service.getRepositories();

              context.ui.addItem(
                {
                  type: 'autopilot_repos',
                  repositories: repos,
                } as Omit<HistoryItem, 'id'>,
                Date.now(),
              );
            } catch (error) {
              return {
                type: 'message',
                messageType: 'error',
                content: `Failed to list repositories: ${(error as Error).message}`,
              };
            }
          },
        },
      ],
    },
    {
      name: 'queue',
      description: 'Manage manual issue queue',
      subCommands: [
        {
          name: 'add',
          description: 'Add issue to manual queue',
          action: async (context, args) => {
            const issueUrl = args.trim();
            return await addToQueue(issueUrl, context);
          },
        },
        {
          name: 'list',
          description: 'Show current queue',
          action: async (context: CommandContext) => {
            try {
              if (!context.services.config) {
                return {
                  type: 'message',
                  messageType: 'error',
                  content: 'Configuration not available',
                };
              }

              const service = AutopilotService.getInstance(
                context.services.config,
                context.services.settings,
              );
              const queue = await service.getQueue();

              context.ui.addItem(
                {
                  type: 'autopilot_queue',
                  queue,
                } as Omit<HistoryItem, 'id'>,
                Date.now(),
              );
            } catch (error) {
              return {
                type: 'message',
                messageType: 'error',
                content: `Failed to get queue: ${(error as Error).message}`,
              };
            }
          },
        },
      ],
    },
  ],
};
