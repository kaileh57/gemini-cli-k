/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config, GeminiClient } from '@google/gemini-cli-core';
import { GitHubIssueData } from '../github/GitHubClient.js';
import { AutopilotDatabase } from '../storage/Database.js';
import { AutopilotSettings } from '../types.js';

export interface ClassificationResult {
  score: number;
  reasoning: string;
  confidence: number;
  category: string;
  estimatedComplexity: 'low' | 'medium' | 'high';
}

export class IssueClassifier {
  private config: Config;
  private database: AutopilotDatabase;
  private settings: AutopilotSettings;
  private geminiClient: GeminiClient;

  constructor(
    config: Config,
    database: AutopilotDatabase,
    settings: AutopilotSettings,
  ) {
    this.config = config;
    this.database = database;
    this.settings = settings;
    this.geminiClient = config.getGeminiClient();
  }

  async classifyIssue(issue: GitHubIssueData): Promise<ClassificationResult> {
    try {
      let result: ClassificationResult;

      // Try Gemini API classification if enabled
      if (this.settings.ai.useGeminiForClassification) {
        try {
          result = await this.geminiClassification(issue);
          this.database.logActivity(
            'info',
            'classification',
            `Gemini classified issue ${issue.number}: score ${result.score}, category ${result.category}`,
          );
        } catch (error) {
          this.database.logActivity(
            'warning',
            'classification',
            `Gemini classification failed for issue ${issue.number}, falling back to heuristics: ${(error as Error).message}`,
          );

          if (this.settings.ai.fallbackClassification) {
            result = this.heuristicClassification(issue);
          } else {
            throw error;
          }
        }
      } else {
        // Use heuristic classification
        result = this.heuristicClassification(issue);
      }

      this.database.logActivity(
        'info',
        'classification',
        `Classified issue ${issue.number}: score ${result.score}, category ${result.category}`,
        {
          issueNumber: issue.number,
          score: result.score,
          category: result.category,
          complexity: result.estimatedComplexity,
        },
      );

      return result;
    } catch (error) {
      this.database.logActivity(
        'error',
        'classification',
        `Failed to classify issue ${issue.number}: ${(error as Error).message}`,
      );

      // Return a low score on error
      return {
        score: 0,
        reasoning: 'Classification failed',
        confidence: 0,
        category: 'unknown',
        estimatedComplexity: 'high',
      };
    }
  }

  private heuristicClassification(
    issue: GitHubIssueData,
  ): ClassificationResult {
    let score = 50; // Base score
    const reasoning = [];
    let category = 'general';
    let complexity: 'low' | 'medium' | 'high' = 'medium';

    const title = issue.title.toLowerCase();
    const body = issue.body?.toLowerCase() || '';
    const labels = issue.labels.map((label) => label.name.toLowerCase());

    // Positive indicators
    const goodFirstIssueLabels = [
      'good first issue',
      'beginner',
      'easy',
      'help wanted',
    ];
    if (labels.some((label) => goodFirstIssueLabels.includes(label))) {
      score += 20;
      reasoning.push('Has beginner-friendly labels');
      complexity = 'low';
      category = 'good-first-issue';
    }

    const documentationKeywords = [
      'doc',
      'readme',
      'documentation',
      'comment',
      'typo',
    ];
    if (
      documentationKeywords.some(
        (keyword) =>
          title.includes(keyword) ||
          body.includes(keyword) ||
          labels.includes(keyword),
      )
    ) {
      score += 15;
      reasoning.push('Documentation-related issue');
      complexity = 'low';
      category = 'documentation';
    }

    const simpleFixKeywords = [
      'typo',
      'spelling',
      'grammar',
      'broken link',
      'dead link',
    ];
    if (
      simpleFixKeywords.some(
        (keyword) => title.includes(keyword) || body.includes(keyword),
      )
    ) {
      score += 25;
      reasoning.push('Simple fix required');
      complexity = 'low';
      category = 'simple-fix';
    }

    const bugKeywords = ['bug', 'error', 'issue', 'problem', 'fix'];
    if (
      bugKeywords.some(
        (keyword) => title.includes(keyword) || labels.includes(keyword),
      )
    ) {
      score += 10;
      reasoning.push('Bug fix');
      category = 'bug';
    }

    // Negative indicators
    const complexKeywords = [
      'refactor',
      'architecture',
      'breaking change',
      'api',
      'major',
    ];
    if (
      complexKeywords.some(
        (keyword) =>
          title.includes(keyword) ||
          body.includes(keyword) ||
          labels.includes(keyword),
      )
    ) {
      score -= 20;
      reasoning.push('Complex architectural changes');
      complexity = 'high';
    }

    const securityKeywords = ['security', 'vulnerability', 'cve', 'exploit'];
    if (
      securityKeywords.some(
        (keyword) =>
          title.includes(keyword) ||
          body.includes(keyword) ||
          labels.includes(keyword),
      )
    ) {
      score -= 30;
      reasoning.push('Security-related issue requires human review');
      complexity = 'high';
      category = 'security';
    }

    const uiKeywords = ['ui', 'design', 'style', 'css', 'layout'];
    if (
      uiKeywords.some(
        (keyword) =>
          title.includes(keyword) ||
          body.includes(keyword) ||
          labels.includes(keyword),
      )
    ) {
      score -= 10;
      reasoning.push('UI/Design changes may require subjective judgment');
      category = 'ui';
    }

    // Check for clear problem description
    if (
      body.length > 100 &&
      (body.includes('step') || body.includes('reproduce'))
    ) {
      score += 10;
      reasoning.push('Clear problem description with reproduction steps');
    }

    // Check for vague or unclear issues
    if (title.length < 10 || body.length < 50) {
      score -= 15;
      reasoning.push('Issue description is too brief or unclear');
    }

    // Check for feature requests
    if (
      title.includes('feature') ||
      title.includes('add') ||
      labels.includes('enhancement')
    ) {
      score -= 5;
      reasoning.push('Feature request may require design decisions');
      category = 'feature';
    }

    // Clamp score to 0-100 range
    score = Math.max(0, Math.min(100, score));

    // Calculate confidence based on number of indicators
    const confidence = Math.min(95, reasoning.length * 15 + 40);

    return {
      score,
      reasoning: reasoning.join('; '),
      confidence,
      category,
      estimatedComplexity: complexity,
    };
  }

  private async geminiClassification(
    issue: GitHubIssueData,
  ): Promise<ClassificationResult> {
    const labels = issue.labels.map((l) => l.name).join(', ');

    const prompt = `Analyze this GitHub issue and provide a score from 0-100 for automated resolution suitability.

Issue Details:
Title: ${issue.title}
Body: ${issue.body || 'No description provided'}
Labels: ${labels || 'None'}

Evaluation Criteria:
1. Clarity of the problem description (0-25 points)
2. Technical complexity - simple fixes score higher (0-25 points)
3. Whether it requires human judgment or creativity (0-25 points)
4. If it's a good fit for automated fixing (0-25 points)

Consider these factors:
- Good first issues, documentation fixes, simple bugs = HIGH scores (80-100)
- Typos, broken links, missing imports = HIGH scores (85-100)
- Security issues, breaking changes, complex features = LOW scores (0-30)
- Vague descriptions, unclear requirements = LOW scores (10-40)

Return ONLY a JSON object with this exact format:
{
  "score": <number 0-100>,
  "reasoning": "<brief explanation of the score>",
  "confidence": <number 0-100>,
  "category": "<one of: bug, documentation, good-first-issue, feature, security, unknown>",
  "estimatedComplexity": "<one of: low, medium, high>"
}`;

    try {
      const chat = await this.geminiClient.getChat();

      const response = await chat.sendMessage(
        {
          message: [{ text: prompt }],
          config: {
            temperature: 0.1, // Low temperature for consistent classification
          },
        },
        `classification-${issue.number}-${Date.now()}`,
      );

      if (
        !response ||
        !response.candidates ||
        response.candidates.length === 0
      ) {
        throw new Error('No response from Gemini API');
      }

      const responseText =
        response.candidates[0]?.content?.parts
          ?.filter((part) => part.text)
          .map((part) => part.text)
          .join('') || '';

      if (!responseText) {
        throw new Error('Empty response from Gemini API');
      }

      // Extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in Gemini response');
      }

      const result = JSON.parse(jsonMatch[0]) as ClassificationResult;

      // Validate the result
      if (
        typeof result.score !== 'number' ||
        result.score < 0 ||
        result.score > 100
      ) {
        throw new Error('Invalid score in Gemini response');
      }

      // Log successful API call
      this.database.logActivity(
        'info',
        'classification',
        'Real Gemini API classification completed',
        {
          issueNumber: issue.number,
          score: result.score,
          category: result.category,
        },
      );

      return result;
    } catch (error) {
      // If JSON parsing fails or API error, fall back to heuristic classification
      this.database.logActivity(
        'warning',
        'classification',
        `Gemini API classification failed for issue ${issue.number}, using enhanced heuristic: ${(error as Error).message}`,
      );

      return this.enhancedHeuristicClassification(issue);
    }
  }

  private enhancedHeuristicClassification(
    issue: GitHubIssueData,
  ): ClassificationResult {
    // Enhanced heuristic classification that follows Gemini's logic patterns
    const title = issue.title.toLowerCase();
    const body = (issue.body || '').toLowerCase();
    const labels = issue.labels.map((l) => l.name.toLowerCase());

    let score = 50;
    const reasoning: string[] = [];
    let confidence = 70;
    let category = 'unknown';
    let complexity: 'low' | 'medium' | 'high' = 'medium';

    // High-scoring cases (80-100)
    if (
      labels.includes('good first issue') ||
      labels.includes('good-first-issue')
    ) {
      score = 95;
      reasoning.push('Explicitly marked as good first issue');
      category = 'good-first-issue';
      complexity = 'low';
      confidence = 95;
    } else if (
      labels.includes('documentation') ||
      title.includes('doc') ||
      title.includes('readme')
    ) {
      score = 90;
      reasoning.push(
        'Documentation update - low risk, high automation success',
      );
      category = 'documentation';
      complexity = 'low';
      confidence = 90;
    } else if (
      title.includes('typo') ||
      title.includes('spelling') ||
      title.includes('broken link')
    ) {
      score = 95;
      reasoning.push('Simple text fix with clear scope');
      category = 'bug';
      complexity = 'low';
      confidence = 95;
    } else if (
      title.includes('missing import') ||
      title.includes('import error')
    ) {
      score = 85;
      reasoning.push('Import fix - usually straightforward');
      category = 'bug';
      complexity = 'low';
      confidence = 85;
    }
    // Medium-scoring cases (40-79)
    else if (labels.includes('bug') && !labels.includes('security')) {
      if (body.includes('reproduce') || body.includes('steps')) {
        score = 75;
        reasoning.push('Bug with clear reproduction steps');
        confidence = 80;
      } else {
        score = 55;
        reasoning.push('Bug but unclear reproduction steps');
        confidence = 60;
      }
      category = 'bug';
      complexity = body.length > 200 ? 'medium' : 'low';
    } else if (labels.includes('enhancement') || labels.includes('feature')) {
      score = 35;
      reasoning.push('Feature requests often require design decisions');
      category = 'feature';
      complexity = 'high';
      confidence = 70;
    }
    // Low-scoring cases (0-39)
    else if (
      labels.includes('security') ||
      body.includes('security') ||
      body.includes('vulnerability')
    ) {
      score = 15;
      reasoning.push('Security issues require careful human review');
      category = 'security';
      complexity = 'high';
      confidence = 90;
    } else if (title.includes('breaking change') || body.includes('breaking')) {
      score = 10;
      reasoning.push('Breaking changes require careful consideration');
      category = 'feature';
      complexity = 'high';
      confidence = 85;
    } else if (title.length < 15 || body.length < 50) {
      score = 25;
      reasoning.push('Insufficient description for automated resolution');
      confidence = 50;
    }

    // Adjust based on description quality
    if (
      body.length > 200 &&
      (body.includes('expected') || body.includes('actual'))
    ) {
      score += 10;
      reasoning.push('Good quality issue description');
      confidence += 10;
    }

    if (body.length < 20) {
      score -= 20;
      reasoning.push('Very brief description reduces automation viability');
      confidence -= 20;
    }

    // Clamp values
    score = Math.max(0, Math.min(100, score));
    confidence = Math.max(30, Math.min(100, confidence));

    return {
      score,
      reasoning: reasoning.join('; '),
      confidence,
      category,
      estimatedComplexity: complexity,
    };
  }

  async shouldAttemptIssue(
    issue: GitHubIssueData,
    repositoryThreshold: number,
  ): Promise<boolean> {
    const classification = await this.classifyIssue(issue);
    return classification.score >= repositoryThreshold;
  }
}
