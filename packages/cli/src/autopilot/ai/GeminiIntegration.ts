/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  ToolRegistry,
  executeToolCall,
  ToolCallRequestInfo,
  GeminiClient,
} from '@google/gemini-cli-core';
import { Content, Part, FunctionCall } from '@google/genai';
import { runNonInteractive } from '../../nonInteractiveCli.js';
import { AutopilotDatabase } from '../storage/Database.js';
import {
  GitHubIssue,
  SolutionResult,
  GeminiResponse,
  GeminiResponsePart,
} from '../types.js';

export class GeminiIntegration {
  private config: Config;
  private database: AutopilotDatabase;
  private geminiClient: GeminiClient;
  private toolRegistry: ToolRegistry | null = null;

  constructor(config: Config, database: AutopilotDatabase) {
    this.config = config;
    this.database = database;
    this.geminiClient = config.getGeminiClient();
  }

  async initialize(): Promise<void> {
    this.toolRegistry = await this.config.getToolRegistry();
  }

  async solveIssue(
    issue: GitHubIssue,
    workspace: string,
    repoOwner: string,
    repoName: string,
  ): Promise<SolutionResult> {
    const startTime = Date.now();

    try {
      if (!this.toolRegistry) {
        await this.initialize();
      }

      // Log the attempt
      this.database.logActivity(
        'info',
        'ai_generation',
        `Starting Gemini integration for issue ${repoOwner}/${repoName}#${issue.issueNumber}`,
        { issueId: issue.id, workspace },
      );

      // Create comprehensive prompt following the analysis-first approach
      const prompt = this.createSolutionPrompt(
        issue,
        repoOwner,
        repoName,
        workspace,
      );

      // Perform large-scale codebase analysis first using gemini -p pattern
      const codebaseAnalysis = await this.performCodebaseAnalysis(
        issue,
        workspace,
      );

      // Enhance the prompt with codebase analysis
      const enhancedPrompt = this.enhancePromptWithAnalysis(
        prompt,
        codebaseAnalysis,
      );

      // Execute Gemini with proper agentic capabilities
      const result = await this.executeGeminiAgent(enhancedPrompt, workspace);

      // Calculate processing time and estimated cost
      const processingTime = (Date.now() - startTime) / 1000;
      const estimatedCost = this.estimateCost(prompt, processingTime);

      // Log completion
      this.database.logActivity(
        'info',
        'ai_generation',
        `Gemini integration completed for issue ${repoOwner}/${repoName}#${issue.issueNumber}`,
        {
          issueId: issue.id,
          success: result.success,
          processingTime,
          estimatedCost,
        },
      );

      return {
        ...result,
        estimatedCost,
      };
    } catch (error) {
      const processingTime = (Date.now() - startTime) / 1000;

      this.database.logActivity(
        'error',
        'ai_generation',
        `Gemini integration failed for issue ${repoOwner}/${repoName}#${issue.issueNumber}: ${(error as Error).message}`,
        { issueId: issue.id, processingTime },
      );

      return {
        success: false,
        error: `Gemini integration failed: ${(error as Error).message}`,
        estimatedCost: this.estimateCost('', processingTime),
      };
    }
  }

  private createSolutionPrompt(
    issue: GitHubIssue,
    repoOwner: string,
    repoName: string,
    workspace: string,
  ): string {
    const labels = issue.labels.join(', ');
    const complexity = this.getComplexityIndicator(issue);

    return `# 🤖 Gemini Autopilot: Autonomous Issue Resolution

You are Gemini, an advanced AI assistant specializing in autonomous software engineering. You have been tasked with resolving a GitHub issue with full autonomy and access to development tools.

## 📋 Mission Brief
**Repository**: ${repoOwner}/${repoName}
**Issue #${issue.issueNumber}**: ${issue.title}
**Priority**: ${complexity}
**URL**: ${issue.issueUrl}
**Labels**: ${labels || 'None'}

## 📝 Issue Description
${issue.body || 'No description provided.'}

## 🎯 Your Autonomous Mission

You have **full autonomy** to resolve this issue. Use your analytical capabilities and the available tools to:

### 🔍 **Phase 1: Deep Analysis**
- **Investigate thoroughly**: Start with \`read_file\` on README.md, package.json, and key directories
- **Pattern recognition**: Use \`grep\` and \`glob\` to understand the codebase patterns and locate relevant files
- **Context building**: Build a mental model of the codebase architecture and the specific issue domain

### 🎯 **Phase 2: Solution Strategy**
- **Root cause analysis**: Identify the exact cause of the issue
- **Impact assessment**: Understand what needs to change and what must remain stable
- **Solution design**: Plan a minimal, elegant fix that addresses the core problem

### 🛠️ **Phase 3: Implementation**
- **Precise execution**: Use \`edit_file\` to implement your solution with surgical precision
- **Convention adherence**: Follow the established patterns and coding standards you observed
- **Completeness**: Ensure your solution handles edge cases and error conditions

### ✅ **Phase 4: Validation & Quality**
- **Test execution**: Run existing tests using \`run_shell_command\` 
- **Verification**: Confirm your fix actually resolves the issue
- **Quality gates**: Run linting, type checking, and any other quality tools

## 🧰 Available Tools
Your toolkit for autonomous operation:
- \`read_file\` - Examine any file in the codebase
- \`edit_file\` - Make precise, targeted modifications
- \`run_shell_command\` - Execute any necessary commands
- \`glob\` - Find files matching specific patterns
- \`grep\` - Search for text patterns across files

## 🎯 Success Criteria
**Mission accomplished when:**
- ✅ Issue is completely resolved
- ✅ All existing tests pass
- ✅ Code follows project conventions
- ✅ No regression bugs introduced
- ✅ Solution is minimal and elegant

## 🚀 Execution Environment
**Working Directory**: ${workspace}
**Autonomy Level**: Full
**Expected Outcome**: Complete issue resolution

## 🎬 Action!
Begin your autonomous analysis now. Trust your capabilities, be systematic in your approach, and deliver a complete solution. You have everything you need to succeed.

**Start with understanding the codebase structure and then proceed with confidence.**`;
  }

  private async executeGeminiAgent(
    prompt: string,
    workspace: string,
  ): Promise<SolutionResult> {
    try {
      if (!this.toolRegistry) {
        throw new Error('Tool registry not initialized');
      }

      const chat = await this.geminiClient.getChat();
      const abortController = new AbortController();

      let currentMessages: Content[] = [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ];

      let turnCount = 0;
      const maxTurns = 50; // Reasonable limit for issue resolution
      let fullOutput = '';
      let hasErrors = false;
      let finalSuccess = false;

      while (turnCount < maxTurns) {
        turnCount++;

        const functionCalls: FunctionCall[] = [];
        let responseText = '';

        // Send message and collect response
        const responseStream = await chat.sendMessageStream(
          {
            message: currentMessages[0]?.parts || [],
            config: {
              abortSignal: abortController.signal,
              tools: [
                {
                  functionDeclarations:
                    this.toolRegistry.getFunctionDeclarations(),
                },
              ],
            },
          },
          `autopilot-${Date.now()}`,
        );

        // Collect streaming response
        for await (const resp of responseStream) {
          if (abortController.signal.aborted) {
            throw new Error('Operation cancelled');
          }

          const textPart = this.getResponseText(resp as unknown as GeminiResponse);
          if (textPart) {
            responseText += textPart;
            fullOutput += textPart;
          }

          if (resp.functionCalls) {
            functionCalls.push(...resp.functionCalls);
          }
        }

        // Check if Gemini indicates completion
        if (this.isTaskComplete(responseText)) {
          finalSuccess = this.isTaskSuccessful(responseText);
          break;
        }

        // Execute any tool calls
        if (functionCalls.length > 0) {
          const toolResponseParts: Part[] = [];

          for (const fc of functionCalls) {
            const callId = fc.id ?? `${fc.name}-${Date.now()}`;
            const requestInfo: ToolCallRequestInfo = {
              callId,
              name: fc.name as string,
              args: (fc.args ?? {}) as Record<string, unknown>,
              isClientInitiated: false,
              prompt_id: `autopilot-${Date.now()}`,
            };

            // Override directory for file operations to use the workspace
            if (
              fc.name &&
              this.isFileOperation(fc.name) &&
              requestInfo.args &&
              !requestInfo.args.directory
            ) {
              requestInfo.args.directory = workspace;
            }

            const toolResponse = await executeToolCall(
              this.config,
              requestInfo,
              this.toolRegistry,
              abortController.signal,
            );

            if (toolResponse.error) {
              hasErrors = true;
              this.database.logActivity(
                'warning',
                'tool_execution',
                `Tool execution error: ${fc.name} - ${toolResponse.error.message}`,
              );
            }

            if (toolResponse.responseParts) {
              const parts = Array.isArray(toolResponse.responseParts)
                ? toolResponse.responseParts
                : [toolResponse.responseParts];

              for (const part of parts) {
                if (typeof part === 'string') {
                  toolResponseParts.push({ text: part });
                } else if (part) {
                  toolResponseParts.push(part);
                }
              }
            }
          }

          // Prepare next message with tool responses
          currentMessages = [
            {
              role: 'user',
              parts:
                toolResponseParts.length > 0
                  ? toolResponseParts
                  : [{ text: 'Continue with the task.' }],
            },
          ];
        } else {
          // No more tool calls, break the loop
          break;
        }
      }

      // Analyze the final result
      const success =
        finalSuccess && !hasErrors && this.analyzeGeminiOutput(fullOutput);

      return {
        success,
        output: fullOutput,
        error: success
          ? undefined
          : 'Task completed but may not have fully resolved the issue',
      };
    } catch (error) {
      throw new Error(
        `Gemini agent execution failed: ${(error as Error).message}`,
      );
    }
  }

  private getResponseText(response: GeminiResponse): string | null {
    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (
        candidate.content &&
        candidate.content.parts &&
        candidate.content.parts.length > 0
      ) {
        return candidate.content.parts
          .filter((part: GeminiResponsePart) => part.text)
          .map((part: GeminiResponsePart) => part.text)
          .join('');
      }
    }
    return null;
  }

  private isFileOperation(toolName: string): boolean {
    const fileOperations = [
      'read_file',
      'edit_file',
      'write_file',
      'glob',
      'grep',
    ];
    return fileOperations.includes(toolName);
  }

  private isTaskComplete(responseText: string): boolean {
    const lowerText = responseText.toLowerCase();
    const completionIndicators = [
      'task completed',
      'issue resolved',
      'solution implemented',
      'fix applied successfully',
      'all tests pass',
      'implementation complete',
      'problem solved',
      'issue fixed',
    ];

    return completionIndicators.some((indicator) =>
      lowerText.includes(indicator),
    );
  }

  private isTaskSuccessful(responseText: string): boolean {
    const lowerText = responseText.toLowerCase();
    const successIndicators = [
      'successfully resolved',
      'fix applied successfully',
      'all tests pass',
      'solution works',
      'issue is now fixed',
      'implementation successful',
    ];

    const failureIndicators = [
      'cannot resolve',
      'unable to fix',
      'tests failed',
      'compilation error',
      'fix did not work',
      'issue persists',
    ];

    const successCount = successIndicators.filter((indicator) =>
      lowerText.includes(indicator),
    ).length;
    const failureCount = failureIndicators.filter((indicator) =>
      lowerText.includes(indicator),
    ).length;

    return successCount > failureCount;
  }

  private analyzeGeminiOutput(output: string): boolean {
    const lowerOutput = output.toLowerCase();

    // Look for success indicators
    const successIndicators = [
      'task completed',
      'issue resolved',
      'solution implemented',
      'fix applied',
      'tests pass',
      'successfully',
      'completed',
    ];

    // Look for failure indicators
    const failureIndicators = [
      'cannot solve',
      'unable to',
      'failed to',
      'error occurred',
      'compilation error',
      'tests failed',
      'issue persists',
    ];

    const successCount = successIndicators.filter((indicator) =>
      lowerOutput.includes(indicator),
    ).length;
    const failureCount = failureIndicators.filter((indicator) =>
      lowerOutput.includes(indicator),
    ).length;

    // Success if we have more success indicators than failure indicators, and at least 2 success indicators
    return successCount >= 2 && successCount > failureCount;
  }

  private getComplexityIndicator(issue: GitHubIssue): string {
    const labels = issue.labels.map((l) => l.toLowerCase());
    const title = issue.title.toLowerCase();
    const body = (issue.body || '').toLowerCase();

    if (labels.includes('good first issue') || labels.includes('easy')) {
      return 'Low - Good first issue';
    }

    if (
      labels.includes('bug') &&
      (title.includes('typo') || title.includes('fix'))
    ) {
      return 'Low - Simple bug fix';
    }

    if (labels.includes('documentation')) {
      return 'Low - Documentation update';
    }

    if (labels.includes('enhancement') || labels.includes('feature')) {
      return 'Medium - Feature enhancement';
    }

    if (labels.includes('security') || body.includes('security')) {
      return 'High - Security related';
    }

    if (labels.includes('breaking change') || body.includes('breaking')) {
      return 'High - Breaking change';
    }

    return 'Medium - Standard issue';
  }

  private estimateCost(prompt: string, processingTimeSeconds: number): number {
    // Rough cost estimation based on prompt length and processing time
    const promptTokens = Math.ceil(prompt.length / 4); // Rough token estimation
    const outputTokens = Math.ceil(processingTimeSeconds * 100); // Estimate based on time

    // Gemini pricing (approximate): varies by model, using rough estimates
    const inputCost = (promptTokens / 1000) * 0.005; // Gemini Pro pricing
    const outputCost = (outputTokens / 1000) * 0.015; // Gemini Pro pricing

    return Math.round((inputCost + outputCost) * 100) / 100; // Round to 2 decimal places
  }

  async validateGeminiAccess(): Promise<boolean> {
    try {
      // Test the Gemini client connection
      const chat = await this.geminiClient.getChat();

      // Try a simple test message
      const testResponse = await chat.sendMessage(
        {
          message: [{ text: 'Test connection - respond with "OK"' }],
          config: {},
        },
        'test-connection',
      );

      return testResponse !== null;
    } catch (error) {
      this.database.logActivity(
        'error',
        'validation',
        `Gemini access validation failed: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Performs large-scale codebase analysis using the gemini -p pattern
   * This leverages the non-interactive CLI for deep codebase understanding
   */
  private async performCodebaseAnalysis(
    issue: GitHubIssue,
    workspace: string,
  ): Promise<string> {
    try {
      this.database.logActivity(
        'info',
        'codebase_analysis',
        `Starting large-scale codebase analysis for issue ${issue.issueNumber}`,
      );

      // Create analysis prompt following project patterns
      const analysisPrompt = `@./ Analyze this codebase structure and identify files related to: ${issue.title}

Issue Context:
- Title: ${issue.title}
- Description: ${issue.body || 'No description provided'}
- Labels: ${issue.labels.join(', ')}

Please provide:
1. **Project Structure Overview**: Understand the overall architecture and organization
2. **Relevant Files**: Identify files that are likely related to this issue
3. **Code Patterns**: Note the coding patterns, frameworks, and conventions used
4. **Dependencies**: Important dependencies and their usage
5. **Test Structure**: How tests are organized and executed

Focus on providing actionable insights for resolving the specific issue described.`;

      // Change to the workspace directory for analysis
      const originalCwd = process.cwd();
      process.chdir(workspace);

      try {
        // Capture stdout for analysis results
        let analysisResult = '';
        const originalWrite = process.stdout.write;

        process.stdout.write = function (chunk: string | Uint8Array): boolean {
          if (typeof chunk === 'string') {
            analysisResult += chunk;
          }
          return true;
        };

        // Run the non-interactive analysis
        await runNonInteractive(
          this.config,
          analysisPrompt,
          `autopilot-analysis-${Date.now()}`,
        );

        // Restore stdout
        process.stdout.write = originalWrite;

        this.database.logActivity(
          'info',
          'codebase_analysis',
          `Codebase analysis completed for issue ${issue.issueNumber}`,
          { analysisLength: analysisResult.length },
        );

        return analysisResult;
      } finally {
        // Always restore the original directory
        process.chdir(originalCwd);
      }
    } catch (error) {
      this.database.logActivity(
        'warning',
        'codebase_analysis',
        `Codebase analysis failed for issue ${issue.issueNumber}: ${(error as Error).message}`,
      );

      // Return fallback analysis
      return `Codebase analysis was not available. Proceeding with direct file exploration.`;
    }
  }

  /**
   * Enhances the solution prompt with insights from codebase analysis
   */
  private enhancePromptWithAnalysis(
    originalPrompt: string,
    codebaseAnalysis: string,
  ): string {
    if (!codebaseAnalysis || codebaseAnalysis.trim().length === 0) {
      return originalPrompt;
    }

    const enhancedPrompt = `${originalPrompt}

## 🔍 Codebase Analysis Results

The following analysis was performed using the large-scale codebase understanding capabilities:

${codebaseAnalysis}

## Updated Instructions

Based on the codebase analysis above, you now have deep context about the project structure and relevant files. Use this information to:

1. **Focus your investigation** on the files and areas identified in the analysis
2. **Follow the established patterns** noted in the codebase analysis
3. **Understand the context** better when implementing your solution
4. **Leverage existing utilities** and frameworks mentioned in the analysis

Proceed with the resolution workflow, using the analysis results to guide your approach.`;

    return enhancedPrompt;
  }
}
