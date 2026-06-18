import { EnhancedJiraTicket } from '../jira/types.js';
import { RepositoryConfig } from '../config.js';

export function buildRepositorySelectionPrompt(
  ticket: EnhancedJiraTicket,
  repositories: RepositoryConfig[]
): string {
  const repoList = repositories
    .map((repo, index) => {
      const defaultFor = repo.defaultFor?.length ? ` (typically for: ${repo.defaultFor.join(', ')})` : '';
      return `${index + 1}. **${repo.project}/${repo.repo}**${defaultFor}`;
    })
    .join('\n');

  return `You need to select the appropriate repository for a Jira ticket that requires branch preparation.

**Ticket Information:**
- Key: ${ticket.key}
- Summary: ${ticket.summary}
- Components: ${ticket.components.join(', ') || 'None'}
- Labels: ${ticket.labels.join(', ') || 'None'}
${ticket.epicKey ? `- Epic: ${ticket.epicKey}` : ''}

**Description:**
${ticket.description || 'No description provided'}

${ticket.acceptanceCriteria ? `**Acceptance Criteria:**\n${ticket.acceptanceCriteria}` : ''}

**Available Repositories:**
${repoList}

**Your Task:**
Select the most appropriate repository for this ticket.

**CRITICAL RULE #1:** If the ticket description explicitly mentions a repository name, you MUST select that exact repository from the list above. This overrides all other considerations.

**Secondary considerations (only if no repository is explicitly mentioned):**
- Which codebase would contain the code that needs to be changed?
- Do the ticket components or labels match a repository's typical scope?
- What type of work is this (frontend, backend, API, integration, etc.)?

**Response Format:**
You MUST respond with ONLY valid JSON in this exact structure (no markdown, no code blocks, just raw JSON):

{
  "repositoryNumber": 1,
  "reasoning": "Brief explanation here",
  "confidence": 0.9
}

Where:
- repositoryNumber: The number (1, 2, 3, etc.) from the list above
- reasoning: Brief explanation of why this repository is appropriate (1-2 sentences)
- confidence: How confident you are in this selection (0.0 to 1.0)

If you're uncertain between multiple repositories, pick the most likely one and set a lower confidence score.`;
}
