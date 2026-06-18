import { EnhancedJiraTicket } from '../jira/types.js';

export function buildTicketEvaluationPrompt(ticket: EnhancedJiraTicket): string {
  return `You are evaluating whether a Jira ticket requires a development branch with CONTEXT.md preparation. Your job is to determine if this ticket involves actual code changes that would benefit from having a prepared branch and codebase context documentation.

**Ticket Information:**
- Key: ${ticket.key}
- Summary: ${ticket.summary}
- Status: ${ticket.status}
- Components: ${ticket.components.join(', ') || 'None'}
- Labels: ${ticket.labels.join(', ') || 'None'}
${ticket.epicKey ? `- Epic: ${ticket.epicKey}` : ''}

**Description:**
${ticket.description || 'No description provided'}

${ticket.acceptanceCriteria ? `**Acceptance Criteria:**\n${ticket.acceptanceCriteria}` : ''}

**Evaluation Criteria:**

**REQUIRES Branch Preparation (shouldPrepare: true):**
- Bug fixes requiring code changes
- New features or functionality
- API or backend changes
- Frontend UI/UX changes
- Refactoring or code improvements
- Performance optimizations
- Security fixes
- Database migrations or schema changes
- Integration work
- Any work involving editing source code files

**DOES NOT Require Branch Preparation (shouldPrepare: false):**
- Confluence documentation updates
- README or markdown-only documentation
- Jira ticket management (creating tickets, updating fields)
- Research or investigation tasks without code changes
- Meeting notes or discussions
- Design mockups or wireframes
- Planning or estimation work
- Pure testing/QA tasks without code changes
- External tool configuration (not in repo)

**Your Task:**
Evaluate this ticket and respond with:
1. **Should prepare branch?** (yes/no) - Does this ticket require code changes?
2. **Work type**: What type of work is this? (e.g., "bug fix", "documentation", "research", "feature development")
3. **Reasoning**: Why does or doesn't this need a branch? (2-3 sentences)
4. **Confidence**: How confident are you in this assessment? (0.0 to 1.0)
5. **Concerns**: List any specific concerns or ambiguities (if any)

Be direct and honest. If the ticket is purely documentation work (like Confluence pages) or non-code work, recommend NOT preparing a branch.`;
}
