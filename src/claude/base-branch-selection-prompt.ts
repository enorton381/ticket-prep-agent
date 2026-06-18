import { EnhancedJiraTicket } from '../jira/types.js';

export function buildBaseBranchSelectionPrompt(
  ticket: EnhancedJiraTicket,
  availableBranches: string[],
  defaultBranch: string
): string {
  const branchList = availableBranches.map((branch, index) => `${index + 1}. ${branch}`).join('\n');

  return `You need to select the appropriate base branch to branch FROM for a Jira ticket.

**Ticket Information:**
- Key: ${ticket.key}
- Summary: ${ticket.summary}
- Components: ${ticket.components.join(', ') || 'None'}
- Labels: ${ticket.labels.join(', ') || 'None'}
${ticket.epicKey ? `- Epic: ${ticket.epicKey}` : ''}

**Description:**
${ticket.description || 'No description provided'}

${ticket.acceptanceCriteria ? `**Acceptance Criteria:**\n${ticket.acceptanceCriteria}` : ''}

**Available Branches:**
${branchList}

**Default Branch:** ${defaultBranch}

**Important Guidelines:**
- **TYPICALLY** you should select an existing **master**, **main**, **release/\***, or **epic/\*** branch to branch from
- **ONLY in very rare cases** should you branch from an existing **dev**, **feature/\***, or **bugfix/\*** branch
- When in doubt or uncertain, **ALWAYS default to: ${defaultBranch}**
- Look for clues in the ticket:
  - Does it mention a specific epic? Look for an epic branch like "epic/PROJ-123"
  - Does it target a specific release? Look for a release branch like "release/2.5"
  - Is this standard new work? Use the default branch (${defaultBranch})
  - Is this a hotfix for production? Look for the main/master branch

**Your Task:**
Select the most appropriate base branch to branch from. Consider:
- Is there an epic branch that matches this ticket's epic?
- Is there a release branch that this work targets?
- For standard development work, use the default branch
- Only use a dev/feature branch if the ticket explicitly states it builds on specific in-progress work

**Respond with:**
1. **Selected branch**: The exact branch name from the list above
2. **Reasoning**: Brief explanation of why this branch is appropriate (1-2 sentences)
3. **Confidence**: How confident are you in this selection? (0.0 to 1.0)

**If confidence < 0.7 or you're uncertain, respond with:**
- Selected branch: ${defaultBranch}
- Reasoning: Defaulting to the repository's default branch due to uncertainty
- Confidence: 1.0`;
}
