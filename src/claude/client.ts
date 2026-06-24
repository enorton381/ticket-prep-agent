import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import { config, RepositoryConfig } from '../config.js';
import { logger } from '../logger.js';
import { EnhancedJiraTicket } from '../jira/types.js';
import { TicketEvaluation, RepositorySelectionResult, BaseBranchSelectionResult } from './types.js';
import { buildTicketEvaluationPrompt } from './prompts.js';
import { buildRepositorySelectionPrompt } from './repository-selection-prompt.js';
import { buildBaseBranchSelectionPrompt } from './base-branch-selection-prompt.js';

export class ClaudeClient {
  private client: AnthropicBedrock;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor() {
    const awsConfig: { awsRegion: string; awsProfile?: string } = {
      awsRegion: config.claude.awsRegion,
    };

    if (config.claude.awsProfile) {
      awsConfig.awsProfile = config.claude.awsProfile;
    }

    this.client = new AnthropicBedrock(awsConfig);
    this.model = config.claude.model;
    this.maxTokens = config.claude.maxTokens;
    this.temperature = config.claude.temperature;

    logger.info(`Initialized Claude client with model: ${this.model}, region: ${config.claude.awsRegion}`);
  }

  async evaluateTicket(ticket: EnhancedJiraTicket): Promise<TicketEvaluation> {
    const startTime = Date.now();

    try {
      logger.info(`Evaluating ticket ${ticket.key} with Claude`);

      const prompt = buildTicketEvaluationPrompt(ticket);

      // Call Claude API with retry logic
      const response = await this.callWithRetry(prompt);

      // Parse the response
      const evaluation = this.parseEvaluationResponse(response);

      const duration = Date.now() - startTime;
      logger.info(`Claude evaluation completed for ${ticket.key} in ${duration}ms - shouldPrepare: ${evaluation.shouldPrepare}, workType: ${evaluation.workType}, confidence: ${evaluation.confidence}`);

      return evaluation;
    } catch (error: any) {
      logger.error(`Claude API error for ticket ${ticket.key}:`, error);

      // Check for AWS SSO expiration
      if (error.message?.includes('ExpiredToken') || error.message?.includes('credentials')) {
        logger.error('AWS SSO credentials may be expired. Run: aws sso login');
      }

      // Fallback: Default to NOT preparing (better to let humans create branches than create unnecessary ones)
      return {
        shouldPrepare: false,
        workType: 'unknown (evaluation failed)',
        reasoning: 'Unable to evaluate automatically due to API error. Skipping branch preparation - manual review recommended.',
        confidence: 0.5,
        concerns: ['Claude API evaluation failed', error.message, 'Manual review recommended'],
      };
    }
  }

  private async callWithRetry(prompt: string, maxRetries: number = 3): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: this.maxTokens,
          temperature: this.temperature,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        });

        // Extract text from response
        const textContent = response.content.find((c) => c.type === 'text');
        if (!textContent || textContent.type !== 'text') {
          throw new Error('No text content in Claude response');
        }

        return textContent.text;
      } catch (error: any) {
        lastError = error;

        // Don't retry on authentication errors
        if (error.message?.includes('ExpiredToken') || error.message?.includes('credentials')) {
          throw error;
        }

        // Exponential backoff
        if (attempt < maxRetries) {
          const backoffMs = Math.pow(2, attempt) * 1000;
          logger.warn(`Claude API retry ${attempt}/${maxRetries} after ${backoffMs}ms`);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    throw lastError || new Error('Claude API call failed after retries');
  }

  private parseEvaluationResponse(responseText: string): TicketEvaluation {
    // Parse new format: "Should prepare branch?"
    const shouldPrepareMatch = responseText.match(/should\s+prepare\s+branch[?:]?\s*(yes|no)/i);
    const shouldPrepare = shouldPrepareMatch ? shouldPrepareMatch[1].toLowerCase() === 'yes' : false;

    // Extract work type (look for "Work type:" section)
    const workTypeMatch = responseText.match(/work\s+type[:\s]+(.+?)(?=\n|$)/i);
    const workType = workTypeMatch ? workTypeMatch[1].trim().replace(/^["']|["']$/g, '') : 'unknown';

    // Extract reasoning (look for "Reasoning:" section)
    const reasoningMatch = responseText.match(/reasoning[:\s]+(.+?)(?=\n\n|\nconfidence|concerns|$)/is);
    const reasoning = reasoningMatch ? reasoningMatch[1].trim() : responseText.substring(0, 200);

    // Extract confidence
    const confidenceMatch = responseText.match(/confidence[:\s]+([\d.]+)/i);
    const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.7;

    // Extract concerns
    const concernsMatch = responseText.match(/concerns[:\s]+(.+?)(?=\n\n|suggested|$)/is);
    const concerns: string[] = [];
    if (concernsMatch) {
      const concernsText = concernsMatch[1];
      const concernLines = concernsText.split('\n').map((line) => line.replace(/^[-*•]\s*/, '').trim()).filter((line) => line.length > 0);
      concerns.push(...concernLines);
    }

    return {
      shouldPrepare,
      workType,
      reasoning: reasoning.replace(/\*\*/g, ''), // Remove markdown bold
      confidence: Math.min(1, Math.max(0, confidence)),
      concerns,
    };
  }

  async selectRepository(
    ticket: EnhancedJiraTicket,
    repositories: RepositoryConfig[]
  ): Promise<RepositorySelectionResult> {
    const startTime = Date.now();

    try {
      logger.info(`Selecting repository for ticket ${ticket.key} from ${repositories.length} options`);

      const prompt = buildRepositorySelectionPrompt(ticket, repositories);

      // Log the prompt for debugging
      logger.debug(`Repository selection prompt:\n${prompt}`);

      // Call Claude API with retry logic
      const response = await this.callWithRetry(prompt);

      // Log Claude's raw response for debugging
      logger.debug(`Claude's repository selection response:\n${response}`);

      // Parse the response
      const selection = this.parseRepositorySelectionResponse(response, repositories);

      const duration = Date.now() - startTime;
      logger.info(
        `Repository selection completed for ${ticket.key} in ${duration}ms - selected: ${selection.repositoryName}, confidence: ${selection.confidence}`
      );

      return selection;
    } catch (error: any) {
      logger.error(`Claude API error during repository selection for ticket ${ticket.key}:`, error);

      // Check for AWS SSO expiration
      if (error.message?.includes('ExpiredToken') || error.message?.includes('credentials')) {
        logger.error('AWS SSO credentials may be expired. Run: aws sso login');
      }

      // Don't fallback - throw error so workflow can handle it appropriately
      throw new Error(`Unable to select repository: ${error.message}`);
    }
  }

  private parseRepositorySelectionResponse(
    responseText: string,
    repositories: RepositoryConfig[]
  ): RepositorySelectionResult {
    try {
      // Try to extract JSON from the response (Claude might wrap it in markdown code blocks)
      let jsonText = responseText.trim();

      // Remove markdown code blocks if present
      const codeBlockMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1];
      }

      // Try to find JSON object if it's embedded in other text
      const jsonMatch = jsonText.match(/\{[\s\S]*"repositoryNumber"[\s\S]*\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }

      const parsed = JSON.parse(jsonText);

      const repositoryNumber = parsed.repositoryNumber || 1;
      const repositoryIndex = repositoryNumber - 1;

      logger.debug(`Parsed JSON response: repositoryNumber=${repositoryNumber}, confidence=${parsed.confidence}`);

      // Validate index
      if (repositoryIndex < 0 || repositoryIndex >= repositories.length) {
        logger.warn(`Invalid repository index ${repositoryIndex} (from repositoryNumber ${repositoryNumber}), defaulting to 0`);
        return {
          repositoryIndex: 0,
          repositoryName: `${repositories[0].project}/${repositories[0].repo}`,
          reasoning: parsed.reasoning || 'Invalid repository number in response',
          confidence: 0.3,
        };
      }

      return {
        repositoryIndex,
        repositoryName: `${repositories[repositoryIndex].project}/${repositories[repositoryIndex].repo}`,
        reasoning: parsed.reasoning || 'No reasoning provided',
        confidence: Math.min(1, Math.max(0, parsed.confidence || 0.7)),
      };
    } catch (error) {
      logger.error('Failed to parse repository selection JSON response:', error);
      logger.debug(`Response text that failed to parse:\n${responseText}`);

      // Fallback to first repository
      return {
        repositoryIndex: 0,
        repositoryName: `${repositories[0].project}/${repositories[0].repo}`,
        reasoning: 'Failed to parse Claude response - using first repository as fallback',
        confidence: 0.3,
      };
    }
  }

  async selectBaseBranch(
    ticket: EnhancedJiraTicket,
    availableBranches: string[],
    defaultBranch: string
  ): Promise<BaseBranchSelectionResult> {
    const startTime = Date.now();

    try {
      logger.info(`Selecting base branch for ticket ${ticket.key} from ${availableBranches.length} branches`);

      const prompt = buildBaseBranchSelectionPrompt(ticket, availableBranches, defaultBranch);

      // Call Claude API with retry logic
      const response = await this.callWithRetry(prompt);

      // Parse the response
      const selection = this.parseBaseBranchSelectionResponse(response, availableBranches, defaultBranch);

      const duration = Date.now() - startTime;
      logger.info(
        `Base branch selection completed for ${ticket.key} in ${duration}ms - selected: ${selection.selectedBranch}, confidence: ${selection.confidence}`
      );

      return selection;
    } catch (error: any) {
      logger.error(`Claude API error during base branch selection for ticket ${ticket.key}:`, error);

      // Check for AWS SSO expiration
      if (error.message?.includes('ExpiredToken') || error.message?.includes('credentials')) {
        logger.error('AWS SSO credentials may be expired. Run: aws sso login');
      }

      // Fallback: Use default branch
      return {
        selectedBranch: defaultBranch,
        reasoning: 'Unable to select automatically due to API error. Using default branch.',
        confidence: 1.0,
      };
    }
  }

  private parseBaseBranchSelectionResponse(
    responseText: string,
    availableBranches: string[],
    defaultBranch: string
  ): BaseBranchSelectionResult {
    // Parse selected branch (look for "Selected branch:")
    const branchMatch = responseText.match(/selected\s+branch[:\s]+(.+?)(?=\n|$)/i);
    let selectedBranch = branchMatch
      ? branchMatch[1].trim().replace(/^["'`]|["'`]$/g, '').replace(/^\*\*|\*\*$/g, '')
      : defaultBranch;

    // Validate that the selected branch exists in available branches
    if (!availableBranches.includes(selectedBranch)) {
      logger.warn(`Selected branch "${selectedBranch}" not found in available branches, using default: ${defaultBranch}`);
      selectedBranch = defaultBranch;
    }

    // Extract reasoning (look for "Reasoning:" section)
    const reasoningMatch = responseText.match(/reasoning[:\s]+(.+?)(?=\n\n|\nconfidence|$)/is);
    const reasoning = reasoningMatch ? reasoningMatch[1].trim() : 'No reasoning provided';

    // Extract confidence
    const confidenceMatch = responseText.match(/confidence[:\s]+([\d.]+)/i);
    let confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.7;

    // If confidence is low (< 0.7), force default branch
    if (confidence < 0.7 && selectedBranch !== defaultBranch) {
      logger.info(`Low confidence (${confidence}) detected, falling back to default branch: ${defaultBranch}`);
      selectedBranch = defaultBranch;
      confidence = 1.0;
    }

    return {
      selectedBranch,
      reasoning: reasoning.replace(/\*\*/g, ''), // Remove markdown bold
      confidence: Math.min(1, Math.max(0, confidence)),
    };
  }

  async generateImplementationGuidance(
    ticket: EnhancedJiraTicket,
    codebaseContext: string
  ): Promise<string> {
    const startTime = Date.now();

    try {
      logger.info(`Generating implementation guidance for ticket ${ticket.key}`);

      const prompt = this.buildImplementationGuidancePrompt(ticket, codebaseContext);

      // Log the prompt for debugging
      logger.debug(`Implementation guidance prompt:\n${prompt}`);

      // Call Claude API with retry logic
      const response = await this.callWithRetry(prompt);

      const duration = Date.now() - startTime;
      logger.info(`Implementation guidance generated for ${ticket.key} in ${duration}ms`);

      return response.trim();
    } catch (error: any) {
      logger.error(`Claude API error during implementation guidance for ticket ${ticket.key}:`, error);

      // Fallback to a generic message
      return 'Unable to generate implementation guidance automatically. Please review the ticket requirements and codebase structure to determine the best approach.';
    }
  }

  private buildImplementationGuidancePrompt(
    ticket: EnhancedJiraTicket,
    codebaseContext: string
  ): string {
    return `You are a senior software engineer helping to plan the implementation of a Jira ticket.

**Ticket Information:**
- Key: ${ticket.key}
- Summary: ${ticket.summary}
- Issue Type: ${ticket.issueType}
- Description:
${ticket.description || 'No description provided'}

${ticket.acceptanceCriteria ? `**Acceptance Criteria:**\n${ticket.acceptanceCriteria}\n` : ''}

**Codebase Context:**
${codebaseContext}

Based on the ticket requirements and codebase context, provide a concise implementation approach. Focus on:

1. **Files to Modify** - List the specific files that likely need changes
2. **Suggested Changes** - Briefly describe what changes are needed in each file
3. **Key Considerations** - Any important technical considerations, edge cases, or potential issues

Keep your response clear, concise, and actionable. Use markdown formatting for readability.`;
  }
}

export const claudeClient = new ClaudeClient();
