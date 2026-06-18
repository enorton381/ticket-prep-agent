# Jira "New" Status Branch Preparation Agent

## Project Overview

A Node.js + TypeScript background agent that automatically prepares development branches for all tickets with "New" status. Claude AI intelligently evaluates whether each ticket requires code changes, selects the appropriate repository and base branch, and generates comprehensive CONTEXT.md files with ticket context and codebase information.

### Key Features
- 🤖 **Claude AI Evaluation**: Determines if tickets need code changes vs. documentation/research work
- 🎯 **Intelligent Repository Selection**: Claude selects the best repository based on ticket content (JSON structured output)
- 🌿 **Smart Base Branch Selection**: Claude intelligently selects which branch to branch from (master, release/*, epic/*)
- 🏷️ **Issue Type-Based Prefixes**: Automatically prefixes branches based on Jira issue type (bugfix/, feature/, etc.)
- ⚡ **Fully Automated Workflow**: Zero user interaction - runs continuously in background
- 🔄 **Multi-Board Support**: Monitors multiple Jira boards simultaneously
- 🗄️ **Bitbucket Integration**: Automatic branch creation and pushing to Bitbucket Server
- 📊 **Codebase Analysis**: Detects tech stack, frameworks, dependencies, and project structure
- 💾 **State Persistence**: Tracks prepared tickets, prevents duplicates, survives restarts
- 📝 **Context-Rich Documentation**: Auto-generated CONTEXT.md with ticket details, commit history, related work
- 💬 **Jira Comments**: Adds informative comments explaining whether branch was prepared or skipped

## Tech Stack

**Runtime & Core:**
- Node.js 18+ with TypeScript 5.4
- ES Modules (type: "module")

**AI & LLM:**
- `@anthropic-ai/bedrock-sdk` - Claude API via AWS Bedrock (SSO authentication)
- Model: `us.anthropic.claude-sonnet-4-5-20250929-v1:0`

**Jira Integration:**
- Jira REST API v3 with Basic Auth
- Fetches tickets by status "New"

**Git & Bitbucket:**
- `simple-git` - Git operations (clone, branch, commit, push)
- Bitbucket Server REST API v1.0 (Basic Auth)

**Utilities:**
- `node-cron` - Scheduled polling
- `winston` - Structured logging with configurable log levels
- `dotenv` - Environment configuration
- `fast-glob` - Fast file pattern matching for codebase analysis

## Architecture

### High-Level Flow

```
Jira Board Polling (every N seconds, configurable via POLL_INTERVAL_SECONDS)
    ↓
Fetch All Tickets with status="New"
    ↓
Filter Out Already-Prepared Tickets
    ↓
For Each Unprepared Ticket:
    ↓
  Fetch Enhanced Ticket Details (including issueType)
    ↓
  Stage 1: Claude Evaluation - "Does this need code changes?"
    - If NO (documentation/research):
      • Add Jira comment explaining why skipped
      • Mark as SKIPPED in state
      • Continue to next ticket
    ↓
  Stage 2: Repository Selection (if multiple repos configured)
    - Claude analyzes ticket description for explicit repo mentions
    - Uses JSON structured output for reliable parsing
    - If can't decide: FAIL workflow with helpful Jira comment
    ↓
  Stage 3: Base Branch Selection
    - Fetch all branches from Bitbucket
    - Filter to only: master, main, release/*, epic/*
    - Claude selects best base branch based on ticket context
    - Falls back to default branch if uncertain (confidence < 0.7)
    ↓
  Stage 4: Branch Preparation
    1. Clone repository (shallow, from selected base branch)
    2. Create branch with format: [prefix/]TICKET-123-slug_base-branch
       - Prefix determined by issue type:
         • Bug → bugfix/
         • Story/New Feature → feature/
         • Epic → epic/
         • Internal Task/Refactor → (no prefix)
    3. Analyze codebase (tech stack, structure, dependencies)
    4. Generate CONTEXT.md with AI implementation guidance
    5. Commit changes (docs: Add CONTEXT.md for TICKET-123)
    6. Push to remote
    7. Add Jira comment with branch link and summary
    ↓
All Tickets Processed
    ↓
Wait for Next Poll Cycle
    ↓
Developer Takes Ticket from "New"
    ↓
Branch Already Prepared with CONTEXT.md Ready!
```

### Component Architecture

```
src/
├── index.ts                    # Main entry point, orchestration
├── config.ts                   # Configuration loading and validation
├── logger.ts                   # Winston logger (supports LOG_LEVEL env var)
│
├── claude/                     # Claude AI Integration
│   ├── client.ts              # ClaudeClient (AWS Bedrock)
│   ├── prompts.ts             # Ticket evaluation prompt templates
│   ├── repository-selection-prompt.ts  # Repository selection (JSON output)
│   ├── base-branch-selection-prompt.ts # Base branch selection prompt
│   └── types.ts               # TicketEvaluation, RepositorySelectionResult, BaseBranchSelectionResult
│
├── jira/                       # Jira Integration
│   ├── client.ts              # JiraClient wrapper (Basic Auth)
│   ├── operations.ts          # Ticket fetching, comments
│   └── types.ts               # JiraTicket, EnhancedJiraTicket (includes issueType)
│
├── bitbucket/                  # Bitbucket & Git Integration
│   ├── client.ts              # BitbucketClient (REST API)
│   │                           # - listBranches() - fetch all branches
│   │                           # - getDefaultBranch() - get repo default
│   ├── operations.ts          # Git operations (clone, branch, push)
│   │                           # - generateBranchName() with issue type prefix
│   └── types.ts               # Repository, RepositorySelection (includes baseBranch)
│
├── codebase/                   # Repository Analysis
│   ├── analyzer.ts            # CodebaseAnalyzer (tech stack detection)
│   ├── claude-md-generator.ts # CONTEXT.md content generation
│   └── types.ts               # CodebaseAnalysis, TechStack
│
├── workflow/                   # Orchestration
│   ├── automated-manager.ts   # AutomatedWorkflowManager (fully automated orchestrator)
│   ├── branch-preparation.ts  # BranchPreparationWorkflow (pipeline)
│   └── state-machine.ts       # WorkflowState enum, WorkflowTicket
│
├── state/                      # Persistence
│   ├── manager.ts             # StateManager (seen tickets, workflows)
│   └── types.ts               # State interface
│
├── temp/                       # Temporary Directory Management
│   └── manager.js             # TempDirectoryManager (cleanup, disk space)
│
└── scheduler/                  # Polling
    └── poller.ts              # Cron-based Jira polling
```

## Configuration (.env)

### Required Variables

**Jira:**
```bash
JIRA_BASE_URL=https://your-jira.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=your_jira_api_token
JIRA_BOARD_IDS=7174,7175  # Comma-separated board IDs
JIRA_USERNAME=your-username
```

**Claude (AWS Bedrock):**
```bash
AWS_REGION=us-east-1
AWS_PROFILE=default  # Optional, uses default AWS credentials
CLAUDE_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0
CLAUDE_MAX_TOKENS=4096
CLAUDE_TEMPERATURE=0.3
```

**Bitbucket:**
```bash
BITBUCKET_URL=https://bitbucket.company.com
BITBUCKET_USERNAME=your-username
BITBUCKET_PASSWORD=your-app-password
BITBUCKET_VERIFY_SSL=false  # Set to false for self-signed certs
```

**Repositories (JSON array):**
```bash
REPOSITORIES=[{"project":"INTG","repo":"dui-entry-ui"},{"project":"V1CFG","repo":"eng"}]
```

Optional `defaultFor` field (not currently used):
```bash
REPOSITORIES=[{"project":"INTG","repo":"dui-entry-ui","defaultFor":["DUI"]},{"project":"V1CFG","repo":"eng"}]
```

**Workflow:**
```bash
POLL_INTERVAL_SECONDS=7200  # Poll every 2 hours (default)
TEMP_DIR_BASE=./temp-repos
CLONE_TIMEOUT_MS=300000  # 5 minutes
MAX_CONCURRENT_CLONES=5
CLEANUP_AFTER_HOURS=24
```

**Logging:**
```bash
LOG_LEVEL=info  # Options: error, warn, info, debug
```

## Branch Naming Convention

Format: `[prefix/]TICKET-123-hyphenated-summary_base-branch`

**Issue Type Prefix Mapping:**
- Bug → `bugfix/TICKET-123-fix-login-error_master`
- Story → `feature/TICKET-123-add-dashboard_release/2.5`
- New Feature → `feature/TICKET-123-implement-sso_master`
- Internal Task → `TICKET-123-update-dependencies_master` (no prefix)
- Refactor → `TICKET-123-cleanup-code_master` (no prefix)
- Epic → `epic/TICKET-123-user-auth-system_master`
- Unknown → `TICKET-123-description_master` (no prefix)

## Claude AI Decision Points

### 1. Ticket Evaluation (Stage 1)

**Determines:** Should we prepare a branch?

**Returns:**
```typescript
{
  shouldPrepare: boolean,
  workType: string,
  reasoning: string,
  confidence: number,
  concerns: string[]
}
```

**Fallback behavior:** If Claude API fails, defaults to `shouldPrepare: false` (conservative - better to skip than create unnecessary branches)

**Prepares for:**
- Bug fixes, features, API changes, frontend work, refactoring, migrations

**Skips for:**
- Documentation, research, meetings, Jira management

### 2. Repository Selection (Stage 2)

**Determines:** Which repository should this work be done in?

**Critical Rule:** If ticket description explicitly mentions a repository (like "V1CFG/eng"), Claude MUST select that repository.

**Returns (JSON structured output):**
```json
{
  "repositoryNumber": 2,
  "reasoning": "Brief explanation",
  "confidence": 0.9
}
```

**Fallback behavior:** If Claude API fails or can't decide, workflow is marked as FAILED and a helpful Jira comment is added explaining the available repositories.

### 3. Base Branch Selection (Stage 3)

**Determines:** Which branch should we branch FROM?

**Branches considered:** Only master, main, release/*, epic/* (excludes feature/*, bugfix/*, dev branches)

**Guidelines:**
- **Typically** selects master, release/*, or epic/* branches
- **Only rarely** would select a dev branch (none are shown to Claude)
- **Defaults to repository default branch** if confidence < 0.7

**Returns:**
```typescript
{
  selectedBranch: string,
  reasoning: string,
  confidence: number
}
```

**Looks for clues in ticket:**
- Epic mentioned? Look for epic/PROJ-123 branch
- Release mentioned? Look for release/2.5 branch
- Standard work? Use master/main

## Key Design Decisions

### 1. Status Filter: "New" (Not "To Do")
- **Configuration:** Line 135 in `src/jira/operations.ts`
- Change JQL query to use different status: `status = "Your Status"`

### 2. Conservative Fallback Strategy
- **Ticket Evaluation:** Defaults to NOT preparing (false negative better than false positive)
- **Repository Selection:** Fails workflow if can't decide (rather than guessing wrong)
- **Base Branch Selection:** Defaults to repository default if uncertain

### 3. JSON Structured Output for Repository Selection
- **Why:** More reliable than parsing natural language responses
- **Format:** Claude responds with pure JSON object
- **Parser:** Handles markdown code blocks and embedded JSON

### 4. Base Branch Filtering
- **Only allows:** master, main, release/*, epic/*
- **Excludes:** feature/*, bugfix/*, hotfix/*, dev
- **Why:** Prevents branching from someone's in-progress work

### 5. Issue Type Prefixes
- **Automatic:** No Claude evaluation needed
- **Mapping:** Defined in `getIssuePrefixFromType()` in `operations.ts`
- **Extensible:** Easy to add new issue types

### 6. CONTEXT.md (Not CLAUDE.md)
- **Renamed:** To avoid Bitbucket pre-receive hook restrictions
- **Contains:** Ticket details, codebase analysis, AI-generated implementation guidance, dependencies

### 7. No Auto-Assignment
- **Why:** Tickets stay in "New", developers self-assign when ready
- **Benefit:** Branch is prepared proactively before anyone takes the ticket

## File Structure

```
C:\Users\enorton\dev\agent\
├── src/                        # TypeScript source
├── dist/                       # Compiled JavaScript
├── data/
│   └── seen-tickets.json      # State file (persisted workflows)
├── temp-repos/                 # Temporary clones (auto-cleaned)
├── .env                        # Configuration (gitignored)
├── package.json
├── tsconfig.json
├── CLAUDE.md                   # This file
└── README.md                   # User-facing documentation
```

## Development

### Installation
```bash
npm install
```

### Development (with auto-reload)
```bash
npm run dev
```

### Production Build
```bash
npm run build
npm start
```

### Debug Mode
```bash
LOG_LEVEL=debug npm start
```

Shows:
- Full prompts sent to Claude
- Claude's raw responses
- Repository/branch selection reasoning
- Detailed API call logs

## Testing

### Test Jira Query
```bash
node test-jira-query.js
```

Shows:
- All tickets on configured boards
- Their actual status names
- Query results for "New" status

### Test Repository Selection
```bash
node test-repo-selection.js
```

Shows:
- Full ticket description as Claude receives it
- Repository mentions in description
- Available repositories
- Bitbucket API tests (branches, default branch, repo info)

## State Management

**Location:** `data/seen-tickets.json`

**Tracks:**
- `workflows`: All ticket workflows with their state (DETECTED, EVALUATING, COMPLETED, FAILED, SKIPPED)
- `lastChecked`: Last successful poll timestamp

**Workflow States:**
- DETECTED - Ticket found, workflow created
- EVALUATING - Claude determining if code changes needed
- AWAITING_REPO_INPUT - Claude selecting repository
- PREPARING_BRANCH - Clone/analyze/generate/push in progress
- COMPLETED - Success
- SKIPPED - No code changes needed
- FAILED - Error occurred

**Cleanup:**
- Completed/Failed/Skipped workflows: removed after 7 days
- In-progress workflows older than 24 hours: marked as failed

## Jira Comments

### Success Comment
```
Branch automatically prepared and ready for development:

Branch: `bugfix/ENGINT-1097-fix-login_master`
View in Bitbucket: https://...

CONTEXT.md has been generated with ticket details, codebase analysis, and implementation guidance.
```

### Skipped - No Code Changes
```
Automated branch preparation was skipped for this ticket.

**Work Type:** documentation
**Reason:** This ticket is for updating Confluence documentation only...

This ticket appears to be documentation work that doesn't require code changes.
If this assessment is incorrect, please manually create a branch.
```

### Skipped - Can't Select Repository
```
Automated branch preparation was skipped for this ticket.

**Reason:** Could not determine which repository this work should be done in.

**Available repositories:**
- INTG/dui-entry-ui
- V1CFG/eng

**What to do:**
1. Review the ticket description and clarify which codebase needs changes
2. Add appropriate component labels to help with automatic repository selection
3. Or manually create a branch in the appropriate repository

**Error details:** ...
```

## Common Tasks

### Change Status Filter

Edit `src/jira/operations.ts` line 135:
```typescript
boardUrl.searchParams.append('jql', `status = "Your Status" ORDER BY created DESC`);
```

### Add New Issue Type Prefix

Edit `src/bitbucket/operations.ts` in `getIssuePrefixFromType()`:
```typescript
if (issueTypeLower === 'your-type') {
  return 'yourprefix/';
}
```

### Change Branch Naming Format

Edit `src/bitbucket/operations.ts` in `generateBranchName()`:
```typescript
return `${prefix}${ticketKey}-${slug}_${parentBranch}`;
```

### Adjust Poll Interval

In `.env`:
```bash
POLL_INTERVAL_SECONDS=3600  # 1 hour
```

### Add New Repository

In `.env`:
```bash
REPOSITORIES=[{"project":"PROJ","repo":"repo-name"},...]
```

## Troubleshooting

### Issue: Agent finds 0 tickets
- **Check:** Status name in Jira (might not be "New")
- **Fix:** Update JQL query in `fetchToDoTickets()`
- **Test:** Run `node test-jira-query.js` to see actual status names

### Issue: 404 error fetching branches
- **Check:** Repository project/repo names are correct
- **Test:** Run `node test-repo-selection.js`
- **Fix:** Verify Bitbucket URLs and credentials

### Issue: Pre-receive hook declined (file not permitted)
- **Cause:** Bitbucket server blocking certain filenames
- **Solution:** Rename the file (we changed CLAUDE.md → CONTEXT.md)

### Issue: Claude selects wrong repository
- **Enable:** `LOG_LEVEL=debug` to see Claude's reasoning
- **Check:** Is repository explicitly mentioned in ticket description?
- **Fix:** Update repository selection prompt if needed

### Issue: AWS SSO credentials expired
```
error: ExpiredToken or credentials
```
- **Fix:** Run `aws sso login` and restart agent

## Performance

**Typical timings per ticket:**
- Jira fetch: 500-1500ms
- Claude evaluation: 8-12 seconds
- Claude repository selection: 8-12 seconds (if multiple repos)
- Claude base branch selection: 8-12 seconds
- Repository clone: 5-30 seconds (shallow clone)
- Codebase analysis: 15-500ms
- Claude implementation guidance generation: 8-15 seconds
- CONTEXT.md generation: <100ms
- Git commit + push: 2-5 seconds

**Total per ticket:** 40-100 seconds depending on configuration

**Resource usage:**
- Memory: ~100-200 MB
- Disk: Temp clones auto-cleaned after push
- CPU: Low idle, moderate during clone/analysis

## Recent Major Changes

**2026-06-17:**
- ✅ Changed from "To Do" to "New" status filtering
- ✅ Switched repository selection to JSON structured output
- ✅ Added intelligent base branch selection with Claude
- ✅ Added branch filtering (only master/release/epic branches)
- ✅ Implemented issue type-based branch prefixes (bugfix/, feature/, etc.)
- ✅ Renamed CLAUDE.md → CONTEXT.md (Bitbucket hook compatibility)
- ✅ Removed robot emojis from Jira comments
- ✅ Changed conservative fallback: evaluation failure → skip instead of prepare
- ✅ Repository selection failure → fail workflow with helpful comment (no guessing)
- ✅ Removed legacy `shouldTake` and `suggestedActions` fields
- ✅ Removed `name` field from repository config (just use project/repo)
- ✅ Renamed all `slug` references to `repo` for consistency
- ✅ Added configurable log levels (LOG_LEVEL environment variable)
- ✅ Added debug logging for Claude prompts and responses

## Project Status

**Current Status:** ✅ **Fully Functional - Automated "New" Status Preparation Mode**

**Active Components:**
- ✅ "New" status monitoring with multi-board support
- ✅ Claude AI evaluation with JSON structured output
- ✅ Intelligent repository selection with explicit mention detection
- ✅ Smart base branch selection (master/release/epic only)
- ✅ Issue type-based branch prefixes
- ✅ Comprehensive CONTEXT.md generation
- ✅ Bitbucket Server integration
- ✅ State persistence and workflow tracking

**Removed/Deprecated:**
- ❌ Interactive notifications (node-notifier, enquirer)
- ❌ WorkflowManager (old interactive workflow)
- ❌ notifications/ directory (unused)
