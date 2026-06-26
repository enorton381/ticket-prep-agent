# Jira Branch Preparation Agent

Automated Node.js agent that monitors Jira tickets with "New" status and prepares development branches using Claude AI for intelligent decision-making.

## What It Does

**Automated 4-Stage Pipeline:**
1. **Evaluation** - Claude determines if ticket needs code changes (skips docs/research tickets)
2. **Repository Selection** - Claude picks correct repository from ticket description (JSON output)
3. **Base Branch Selection** - Claude selects appropriate branch (master/release/*/epic/*)
4. **Branch Creation** - Clones repo, analyzes codebase, generates CONTEXT.md, pushes branch with issue-type prefix

**Result:** When developers pick up a "New" ticket, the branch is already prepared with context documentation.

## Tech Stack

- **Runtime:** Node.js 18+, TypeScript 5.4, ES Modules
- **AI:** Claude Sonnet 4.5 via AWS Bedrock SDK
- **APIs:** Jira REST API v3, Bitbucket Server REST API v1.0
- **Git:** `simple-git` for operations
- **Utils:** `node-cron` (polling), `winston` (logging), `fast-glob` (analysis)

## Architecture

```
src/
├── index.ts                    # Main orchestrator
├── config.ts                   # Environment config loader
├── logger.ts                   # Winston logger
├── claude/                     # AI client + prompts (evaluation, repo/branch selection)
├── jira/                       # Ticket fetching, commenting
├── bitbucket/                  # Git operations, branch management
├── codebase/                   # Tech stack analyzer, CONTEXT.md generator
├── workflow/                   # AutomatedWorkflowManager, BranchPreparationWorkflow
├── state/                      # Persistence (seen-tickets.json)
└── scheduler/                  # Cron polling
```

## Workflow Pipeline

```
Poll Jira (POLL_INTERVAL_SECONDS) → Fetch "New" tickets → Filter already-processed
  ↓
For each ticket:
  Stage 1: Claude evaluation → shouldPrepare? (yes=continue, no=skip+comment)
  Stage 2: Repository selection → Claude picks from REPOSITORIES (explicit mentions prioritized)
  Stage 3: Base branch selection → Claude picks from master/main/release/*/epic/* (confidence < 0.7 = fallback to default)
  Stage 4: Branch preparation → Clone → Create [prefix/]KEY-slug_base → Analyze → Generate CONTEXT.md → Push → Comment
```

## Configuration (.env)

**Jira:**
```bash
JIRA_BASE_URL=https://jira.company.com
JIRA_EMAIL=user@company.com
JIRA_API_TOKEN=token
JIRA_BOARD_IDS=7174,7175  # Comma-separated
JIRA_USERNAME=username
```

**Claude (AWS Bedrock):**
```bash
AWS_REGION=us-east-1
AWS_PROFILE=default  # Optional
CLAUDE_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0
CLAUDE_MAX_TOKENS=4096
CLAUDE_TEMPERATURE=0.3
```

**Bitbucket:**
```bash
BITBUCKET_URL=https://bitbucket.company.com
BITBUCKET_USERNAME=username
BITBUCKET_PASSWORD=app-password
BITBUCKET_VERIFY_SSL=false  # For self-signed certs
```

**Repositories (JSON array):**
```bash
REPOSITORIES=[{"project":"INTG","repo":"dui-entry-ui"},{"project":"V1CFG","repo":"eng"}]
# Optional: "defaultFor":["COMPONENT"] (not currently used)
```

**Workflow:**
```bash
POLL_INTERVAL_SECONDS=7200  # 2 hours default
TEMP_DIR_BASE=./temp-repos
CLONE_TIMEOUT_MS=300000
MAX_CONCURRENT_CLONES=5
CLEANUP_AFTER_HOURS=24
LOG_LEVEL=info  # error, warn, info, debug
```

## Branch Naming

**Format:** `[prefix/]TICKET-123-summary_base-branch`

**Issue Type Prefixes (automatic):**
- Bug → `bugfix/`
- Story/New Feature → `feature/`
- Epic → `epic/`
- Internal Task/Refactor → (no prefix)

**Examples:**
- `bugfix/VEST-123-fix-login_master`
- `feature/VEST-456-add-dashboard_release/2.5`
- `VEST-789-update-deps_master`

**Location:** `src/bitbucket/operations.ts:getIssuePrefixFromType()`

## Claude Decision Points

### Stage 1: Ticket Evaluation
**Returns:** `{shouldPrepare, workType, reasoning, confidence, concerns}`
- **Prepares for:** Bug fixes, features, API changes, refactoring, migrations
- **Skips:** Documentation, research, meetings, Jira management
- **Fallback:** API failure → `shouldPrepare: false` (conservative)

### Stage 2: Repository Selection
**Returns:** JSON `{repositoryNumber, reasoning, confidence}`
- **Critical:** Explicit repository mentions (e.g., "V1CFG/eng") → MUST select that repo
- **Fallback:** Can't decide → FAIL workflow + helpful Jira comment (no guessing)

### Stage 3: Base Branch Selection
**Returns:** `{selectedBranch, reasoning, confidence}`
- **Considered:** Only master, main, release/*, epic/* (excludes feature/*, bugfix/*, dev)
- **Clues:** Epic mentioned → epic/PROJ-123, Release → release/2.5, Standard → master/main
- **Fallback:** confidence < 0.7 → repository default branch

## Key Design Decisions

1. **Status Filter:** Monitors "New" (not "To Do") - change in `src/jira/operations.ts:135`
2. **Conservative Fallbacks:** Evaluation failure → skip; Repository failure → fail (no guessing); Branch failure → default
3. **JSON Structured Output:** Repository selection uses JSON for reliable parsing
4. **Base Branch Filtering:** Only stable branches (prevents branching from WIP feature branches)
5. **CONTEXT.md (not CLAUDE.md):** Renamed to avoid Bitbucket pre-receive hook restrictions
6. **No Auto-Assignment:** Tickets stay "New" until developer self-assigns

## State Management

**Location:** `data/seen-tickets.json`

**Workflow States:**
- DETECTED → EVALUATING → AWAITING_REPO_INPUT → PREPARING_BRANCH → COMPLETED/SKIPPED/FAILED

**Cleanup:**
- Completed/Failed/Skipped: removed after 7 days
- In-progress > 24h: marked as failed

## Commands

**Development:**
```bash
npm install
npm run dev          # Auto-reload
npm run build        # Compile TypeScript
npm start            # Production
LOG_LEVEL=debug npm start  # Debug mode (shows prompts/responses)
```

**Testing:**
```bash
node test-jira-query.js         # Test Jira status names
node test-repo-selection.js     # Test Bitbucket API + repo selection
```

## Common Customizations

**Change Status Filter:**
`src/jira/operations.ts:135` - Update JQL: `status = "Your Status"`

**Add Issue Type Prefix:**
`src/bitbucket/operations.ts:getIssuePrefixFromType()` - Add case for new issue type

**Change Branch Format:**
`src/bitbucket/operations.ts:generateBranchName()` - Modify template

**Adjust Poll Interval:**
`.env:POLL_INTERVAL_SECONDS=3600`

**Add Repository:**
`.env:REPOSITORIES=[...,{"project":"PROJ","repo":"name"}]`

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Agent finds 0 tickets | Status might not be "New" - run `test-jira-query.js` to see actual status names |
| 404 fetching branches | Verify `REPOSITORIES` project/repo names - run `test-repo-selection.js` |
| Pre-receive hook declined | Bitbucket blocking filename - rename generated file (CLAUDE.md → CONTEXT.md) |
| Claude selects wrong repo | Enable `LOG_LEVEL=debug` to see reasoning - check if repo explicitly mentioned in ticket |
| AWS credentials expired | Run `aws sso login` and restart |

## Performance

**Per Ticket:** 40-100 seconds total
- Jira fetch: 0.5-1.5s
- Claude evaluation: 8-12s
- Claude repo selection: 8-12s (if multiple repos)
- Claude base branch selection: 8-12s
- Repository clone: 5-30s (shallow)
- Codebase analysis: 15-500ms
- CONTEXT.md generation: 8-15s (Claude) + <100ms (file)
- Git push: 2-5s

**Resources:** ~100-200 MB memory, temp clones auto-cleaned, low CPU idle
