## Project Overview

This agent monitors Jira boards for tickets in the "To Do" status. For each ticket, Claude AI evaluates whether the work requires code changes (vs. documentation-only work like Confluence pages). For code-related tickets, the agent automatically:

1. **Evaluates the ticket** - Claude determines if a branch is needed (code work) or not (docs/research)
2. **Auto-selects repository** - Uses component-to-repository mapping
3. **Creates feature branch** - Clones repo and creates a properly named branch
4. **Analyzes codebase** - Detects tech stack, frameworks, dependencies, project structure
5. **Generates CLAUDE.md** - Comprehensive context document with ticket details, commit history, related work
6. **Commits and pushes** - Automated commit to remote repository
7. **Updates Jira** - Adds comment with branch link and CLAUDE.md summary

When developers take a ticket from "To Do", the branch is already prepared with all the context Claude Code needs to help them complete the work efficiently.

**Future Goals:** Have Claude complete easy tickets and make pull requests, only stopping and forwarding to a human when necessary. 