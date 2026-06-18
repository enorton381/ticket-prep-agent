# Setup Instructions

## Prerequisites Installation

### 1. Install Node.js

The Jira Ticket Monitor Agent requires Node.js 18 or higher.

**Download and Install:**
1. Go to [https://nodejs.org/](https://nodejs.org/)
2. Download the LTS version (Long Term Support)
3. Run the installer and follow the prompts
4. Accept the default settings
5. Verify installation by opening a new terminal and running:
   ```bash
   node --version
   npm --version
   ```

### 2. Install Project Dependencies

Once Node.js is installed, navigate to the project directory and run:

```bash
cd C:\Users\enorton\dev\agent
npm install
```

This will install all required packages:
- `jira-client` - Jira API integration
- `node-notifier` - Desktop notifications
- `node-cron` - Scheduling
- `winston` - Logging
- `dotenv` - Configuration management
- `open` - Browser integration
- TypeScript and type definitions

### 3. Configure Jira Credentials

Follow the instructions in [README.md](README.md) to:
1. Generate a Jira API token
2. Find your board ID(s) - you can monitor multiple boards by providing a comma-separated list
3. Create a `.env` file with your credentials

### 4. Build the Project

Compile the TypeScript code to JavaScript:

```bash
npm run build
```

### 5. Run the Agent

Start the agent:

```bash
npm start
```

## Quick Start After Node.js Installation

```bash
# Install dependencies
npm install

# Create .env file from template
cp .env.example .env

# Edit .env with your Jira credentials
notepad .env

# Build the project
npm run build

# Run the agent
npm start
```

## Next Steps

Once the agent is running successfully, consider:
1. Setting up PM2 for background execution
2. Configuring Windows Task Scheduler for auto-start on boot
3. Adjusting the polling interval in `.env` if needed