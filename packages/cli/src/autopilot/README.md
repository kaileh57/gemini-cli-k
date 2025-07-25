# Gemini CLI Autopilot

An autonomous coding agent that automatically monitors GitHub repositories and solves issues using AI.

## Features

- **Repository Monitoring**: Automatically scans whitelisted repositories for new issues
- **AI-Powered Classification**: Analyzes issues to determine suitability for automated resolution
- **Safety Controls**: Comprehensive safety measures including daily limits and repository limits
- **Manual Queue**: Add specific issues to a manual processing queue with priority support
- **Real-time Status**: Dashboard showing current activity, queue status, and daily statistics
- **Gemini Integration**: Uses native Gemini CLI for implementing solutions

## Configuration

Add autopilot settings to your `.gemini/settings.json`:

```json
{
  "autopilot": {
    "enabled": true,
    "dailyLimits": {
      "totalAttempts": 10,
      "totalPRs": 5,
      "totalCostUSD": 50.0
    },
    "repositoryLimits": {
      "attemptsPerRepo": 3,
      "prsPerRepo": 2
    },
    "scanning": {
      "intervalMinutes": 15,
      "issueScoreThreshold": 70
    },
    "safety": {
      "requireTests": true,
      "maxWorkspaceSize": "1GB",
      "timeoutMinutes": 30
    },
    "ai": {
      "useGeminiForClassification": true,
      "fallbackClassification": true
    }
  }
}
```

## Commands

### Service Management

- `/autopilot start` - Start the autopilot service
- `/autopilot stop` - Stop the autopilot service
- `/autopilot status` - Show current status and statistics

### Repository Management

- `/autopilot repos add owner/name` - Add repository to whitelist
- `/autopilot repos remove owner/name` - Remove repository from whitelist
- `/autopilot repos list` - List whitelisted repositories

### Queue Management

- `/autopilot queue add <issue-url>` - Add issue to manual queue
- `/autopilot queue list` - Show current queue

## Safety Features

- **Daily Limits**: Prevents excessive API usage and costs
- **Repository Limits**: Per-repository limits to prevent disruption
- **Test Validation**: Ensures tests pass before creating PRs
- **Workspace Isolation**: Each issue is processed in an isolated workspace
- **Emergency Stop**: Can be stopped immediately if needed

## How It Works

1. **Monitoring**: Scans whitelisted repositories for new issues
2. **Classification**: Analyzes issues using AI to determine suitability
3. **Processing**: Creates isolated workspace and clones repository
4. **Solution**: Uses native Gemini CLI to implement a solution
5. **Validation**: Runs tests to ensure solution doesn't break anything
6. **Submission**: Creates pull request with solution

## Issue Classification

The autopilot automatically evaluates issues based on:

- **Clarity**: Clear problem description with reproduction steps
- **Complexity**: Simple fixes like typos, documentation updates, or small bugs
- **Labels**: Issues marked as "good first issue" or "beginner"
- **Risk**: Avoids security-related or architectural changes

Issues with scores above the threshold (default: 70) are automatically processed.

## Getting Started

### Prerequisites

- GitHub CLI (`gh`) authenticated with repository access
- Gemini CLI (already available as part of the system)
- Sufficient permissions to create branches and pull requests

### Quick Start

1. Configure autopilot settings in your `.gemini/settings.json` (see Configuration above)
2. Start Gemini CLI: `gemini`
3. Add a repository: `/autopilot repos add owner/repository`
4. Check status: `/autopilot status`
5. Start the service: `/autopilot start`

### Available Commands

- `/autopilot start` - Start the autopilot service
- `/autopilot stop` - Stop the autopilot service
- `/autopilot status` - Show current status and dashboard
- `/autopilot repos add <owner/repo>` - Add repository to monitoring
- `/autopilot repos list` - List monitored repositories
- `/autopilot queue add <issue-url>` - Add issue to manual queue
- `/autopilot queue list` - Show current queue status

## Limitations

- Only processes issues that meet safety and complexity criteria
- Requires human review for complex architectural changes
- Does not handle issues requiring subjective design decisions
- Limited to text-based code changes (no binary files)
