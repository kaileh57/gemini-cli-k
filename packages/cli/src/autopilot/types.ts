/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AutopilotSettings {
  enabled: boolean;
  dailyLimits: {
    totalAttempts: number;
    totalPRs: number;
    totalCostUSD: number;
  };
  repositoryLimits: {
    attemptsPerRepo: number;
    prsPerRepo: number;
  };
  scanning: {
    intervalMinutes: number;
    issueScoreThreshold: number;
  };
  safety: {
    requireTests: boolean;
    maxWorkspaceSize: string;
    timeoutMinutes: number;
  };
  ai: {
    geminiApiKey?: string;
    useGeminiForClassification: boolean;
    fallbackClassification: boolean;
  };
  workspaceBase: string;
  databasePath: string;
}

export interface Repository {
  id: number;
  owner: string;
  name: string;
  enabled: boolean;
  dailyAttemptLimit: number;
  dailyPRLimit: number;
  scoreThreshold: number;
  createdAt: string;
  updatedAt: string;
  // Stats from daily tracking
  todayAttempts: number;
  todayPRs: number;
}

export interface ClassificationMetadata {
  scoreBreakdown: {
    clarity: number;
    complexity: number;
    labels: number;
    risk: number;
  };
  reasoning: string;
  confidence: number;
}

export interface GitHubIssue {
  id: number;
  repositoryId: number;
  issueNumber: number;
  title: string;
  body: string;
  labels: string[];
  issueUrl: string;
  complexityScore?: number;
  classificationMetadata?: ClassificationMetadata;
  lastAttemptedAt?: string;
  attemptCount: number;
  status: 'pending' | 'attempted' | 'solved' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface TestResults {
  command: string;
  passed: boolean;
  output: string;
  duration: number;
  exitCode: number;
}

export interface AttemptHistory {
  id: number;
  issueId: number;
  startedAt: string;
  completedAt?: string | null;
  status: 'in_progress' | 'success' | 'failure' | 'timeout' | 'cancelled';
  errorMessage?: string | null;
  workspacePath?: string | null;
  prNumber?: number | null;
  prUrl?: string | null;
  aiCostUsd: number;
  classificationScore?: number | null;
  solutionSummary?: string | null;
  testResults?: TestResults | null;
  codeChangesSummary?: string | null;
}

export interface QueueItem {
  id: number;
  issueId: number;
  priority: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  requestedBy: string;
  requestedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  errorMessage?: string | null;
  estimatedCompletionTime?: number | null;
  // Joined fields
  title?: string;
  issueUrl?: string;
  repoOwner?: string;
  repoName?: string;
}

export interface DailyStats {
  date: string;
  totalAttempts: number;
  totalPrs: number;
  totalCostUsd: number;
  successfulAttempts: number;
  failedAttempts: number;
  avgCompletionTimeMinutes: number;
}

export interface ActivityMetadata {
  issueId?: number;
  repositoryId?: number;
  workspacePath?: string;
  duration?: number;
  analysisLength?: number;
  processingTime?: number;
  estimatedCost?: number;
  success?: boolean;
  [key: string]: unknown;
}

export interface Activity {
  id: number;
  timestamp: string;
  level: 'info' | 'warning' | 'error' | 'debug';
  category: string;
  message: string;
  metadata?: ActivityMetadata | null;
  issueId?: number | null;
  repositoryId?: number | null;
}

export interface AttemptResult {
  success: boolean;
  error?: string;
  prNumber?: number;
  prUrl?: string;
  aiCost?: number;
  solutionSummary?: string;
  testResults?: TestResults;
  codeChangesSummary?: string;
}

export interface RepositoryConfig {
  dailyAttemptLimit: number;
  dailyPRLimit: number;
  scoreThreshold: number;
}

export interface AutopilotStatus {
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

export interface AutopilotMetrics {
  successRate: number;
  avgResolutionTime: number;
  totalIssuesProcessed: number;
  totalPRsCreated: number;
  totalCostUsd: number;
  errorRate: number;
  userSatisfactionScore: number;
}

export interface SolutionResult {
  success: boolean;
  error?: string;
  output?: string;
  estimatedCost?: number;
}

// Note: CommandContext is imported from '../../ui/commands/types.js' where it's needed

// Database row interfaces for better typing
export interface DatabaseRow {
  [key: string]: unknown;
}

export interface RepositoryRow extends DatabaseRow {
  id: number;
  owner: string;
  name: string;
  enabled: number;
  daily_attempt_limit: number;
  daily_pr_limit: number;
  score_threshold: number;
  created_at: string;
  updated_at: string;
  today_attempts: number;
  today_prs: number;
}

export interface IssueRow extends DatabaseRow {
  id: number;
  repository_id: number;
  issue_number: number;
  title: string;
  body: string;
  labels: string;
  issue_url: string;
  complexity_score: number | null;
  classification_metadata: string | null;
  last_attempted_at: string | null;
  attempt_count: number;
  status: 'pending' | 'attempted' | 'solved' | 'failed';
  created_at: string;
  updated_at: string;
}

export interface QueueRow extends DatabaseRow {
  id: number;
  issue_id: number;
  priority: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  requested_by: string;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  estimated_completion_time: number | null;
  title: string;
  issue_url: string;
  owner: string;
  name: string;
}

export interface AttemptRow extends DatabaseRow {
  id: number;
  issue_id: number;
  started_at: string;
  completed_at: string | null;
  status: 'in_progress' | 'success' | 'failure' | 'timeout' | 'cancelled';
  error_message: string | null;
  workspace_path: string;
  pr_number: number | null;
  pr_url: string | null;
  ai_cost_usd: number;
  classification_score: number | null;
  solution_summary: string | null;
  test_results: string | null;
  code_changes_summary: string | null;
}

export interface ActivityRow extends DatabaseRow {
  id: number;
  timestamp: string;
  level: 'info' | 'warning' | 'error' | 'debug';
  category: string;
  message: string;
  metadata: string | null;
  issue_id: number | null;
  repository_id: number | null;
}

export interface StatsRow extends DatabaseRow {
  status: string;
  count: number;
}

export interface RepositoryStatsRow extends DatabaseRow {
  attempts: number;
  prs: number;
  cost_usd: number;
}

// Gemini API response interfaces
export interface GeminiResponsePart {
  text?: string;
  [key: string]: unknown;
}

export interface GeminiResponseCandidate {
  content?: {
    parts?: GeminiResponsePart[];
  };
  [key: string]: unknown;
}

export interface GeminiResponse {
  candidates?: GeminiResponseCandidate[];
  [key: string]: unknown;
}
