# Saim - Virtual Executive Assistant

Saim is an AI-powered Virtual Executive Assistant designed specifically for the CEO of Next Gen Learning. It helps you excel in your four core responsibilities:

1. **Set Strategy** - Always aware of your strategic plan, helping you stay aligned
2. **Build the Leadership Team** - Track team communications and support people decisions
3. **Allocate Capital** - Access to financial data for informed resource decisions
4. **Set Values and Standards** - Pattern recognition to guide when/how to reinforce values

## Features

### Core Capabilities

- **Strategic Plan Integration**: Automatically syncs with your NGL One-Page Strategic Plan Google Doc
- **Slack Communication**: Full access to public channels and private DMs for pattern recognition
- **Financial Visibility**: Syncs with Google Sheets containing financial statements and forecasts
- **HR Document Access**: Can access employment agreements and alignment conversations for direct reports
- **Pattern Recognition**: Identifies trends, sentiment shifts, and values alignment across communications
- **Delegated Tasks**: Can engage with direct reports on your behalf and summarize conversations
- **Daily Briefings**: Automated morning briefings with insights and action items

### Direct Reports Supported

- Hagen Rode
- Sammy-Jane Every
- Ester van der Walt
- Claire du Preez
- Rod du Preez
- Robyn Costa
- Andre Grobler
- Jannah Ruthven
- Stella Pickard

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          SAIM                                    │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Slack     │  │   Google    │  │     Claude API          │  │
│  │   Bot       │  │   APIs      │  │     (AI Engine)         │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
│         │                │                      │                │
│  ┌──────┴────────────────┴──────────────────────┴─────────────┐ │
│  │                    Assistant Core                           │ │
│  │  • Context Management  • Pattern Recognition                │ │
│  │  • Delegation System   • Values Guidance                    │ │
│  └─────────────────────────┬───────────────────────────────────┘ │
│                            │                                     │
│  ┌─────────────────────────┴───────────────────────────────────┐ │
│  │                    PostgreSQL Database                       │ │
│  │  • Conversation History  • Communication Patterns            │ │
│  │  • Delegated Tasks       • Strategic Plan Versions           │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Setup Guide

### Prerequisites

- Node.js 20+
- PostgreSQL database
- Slack workspace with admin access
- Google Cloud project with APIs enabled
- Anthropic API key

### 1. Slack App Setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Enable **Socket Mode** under Socket Mode settings
3. Create an **App-Level Token** with `connections:write` scope
4. Under **OAuth & Permissions**, add these Bot Token Scopes:
   - `app_mentions:read`
   - `channels:history`
   - `channels:read`
   - `chat:write`
   - `groups:history`
   - `groups:read`
   - `im:history`
   - `im:read`
   - `im:write`
   - `users:read`
5. Under **Event Subscriptions**, subscribe to:
   - `app_mention`
   - `message.channels`
   - `message.groups`
   - `message.im`
6. Under **Slash Commands**, create `/saim` command
7. Install the app to your workspace
8. Note down:
   - Bot User OAuth Token (`xoxb-...`)
   - Signing Secret
   - App-Level Token (`xapp-...`)

### 2. Google Cloud Setup

1. Create a new project in [Google Cloud Console](https://console.cloud.google.com)
2. Enable these APIs:
   - Google Docs API
   - Google Sheets API
   - Google Drive API
3. Create a Service Account:
   - Go to IAM & Admin → Service Accounts
   - Create a new service account
   - Download the JSON key file
4. Share your documents with the service account email:
   - Open your Strategic Plan Google Doc
   - Click Share and add the service account email as Viewer
   - Do the same for financial spreadsheets and HR documents

### 3. Railway Deployment

1. Create a new project on [Railway](https://railway.app)
2. Add a PostgreSQL database service
3. Connect your GitHub repository
4. Add environment variables (see Configuration below)
5. Deploy!

### 4. Configuration

Create a `.env` file with:

```env
# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token

# Anthropic Claude API
ANTHROPIC_API_KEY=sk-ant-your-api-key

# Google Cloud Configuration
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"

# Google Document IDs (extract from document URLs)
STRATEGIC_PLAN_DOC_ID=1O8658LUv3EPOH7FmgTz-Gv0asZjmcfWVOdVxg_QbYXE

# Database (Railway provides this automatically)
DATABASE_URL=postgresql://user:password@host:port/database

# CEO Configuration (your Slack user ID)
CEO_SLACK_USER_ID=U_YOUR_USER_ID

# Application Settings
PORT=3000
NODE_ENV=production
LOG_LEVEL=info

# Sync Intervals (in minutes)
STRATEGIC_PLAN_SYNC_INTERVAL=60
SLACK_HISTORY_SYNC_INTERVAL=15
FINANCIAL_SYNC_INTERVAL=120
```

### 5. Database Setup

After deployment, run migrations:

```bash
npm run db:migrate
npm run db:seed
```

### 6. Update Direct Report Information

After the initial seed, update the direct reports table with actual Slack user IDs and document references. You can do this via SQL:

```sql
UPDATE direct_reports
SET slack_user_id = 'U_ACTUAL_ID',
    email = 'actual@email.com',
    employment_agreement_doc_id = 'google_doc_id',
    alignment_conversation_doc_id = 'google_doc_id'
WHERE name = 'Hagen Rode';

-- Repeat for each direct report
```

## Usage

### Talking to Saim

**Via Direct Message:**
Just DM Saim directly in Slack.

**Via Mention:**
`@Saim what are the key themes in recent team discussions?`

**Via Slash Command:**
`/saim summarize our strategic priorities`

### CEO Commands

**Delegation:**
```
Delegate to Hagen: Please provide an update on the Q1 initiative
Ask Claire to share her thoughts on the new marketing strategy
```

**Strategic Plan:**
```
What does our strategic plan say about growth targets?
How are we tracking against our strategy?
```

**Pattern Detection:**
```
What patterns have you noticed this week?
Are there any concerning trends I should know about?
```

**Values Guidance:**
```
When should I reinforce our values right now?
Which team members are exemplifying our values?
```

### Automated Features

- **Daily Briefing**: Sent at 8 AM with key insights
- **Pattern Analysis**: Runs every 4 hours
- **Stale Task Alerts**: Notifies you when delegated tasks are pending >24 hours
- **Document Sync**: Strategic plan syncs hourly, financials every 2 hours

## Development

### Local Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run type checking
npm run typecheck

# Run linting
npm run lint
```

### Project Structure

```
src/
├── assistant/       # AI assistant core
│   ├── claude.ts    # Claude API integration
│   ├── context.ts   # Conversation context management
│   ├── processor.ts # Message processing logic
│   └── prompts.ts   # System prompts
├── config/          # Configuration
├── db/              # Database schema and migrations
├── integrations/    # External service integrations
│   ├── google/      # Google Docs/Sheets/Drive
│   └── slack/       # Slack bot and handlers
├── services/        # Business logic services
│   ├── patterns.ts  # Pattern recognition
│   ├── scheduler.ts # Scheduled tasks
│   └── tasks.ts     # Delegated task management
├── types/           # TypeScript types
├── utils/           # Utilities (logger, etc.)
└── index.ts         # Application entry point
```

## Adding Financial Sheets

To track a new financial sheet, insert into the database:

```sql
INSERT INTO financial_sheets (sheet_id, name, sheet_type, description)
VALUES (
  '1ABC...xyz',  -- Google Sheet ID from URL
  'Q1 2024 P&L',
  'statement',   -- 'statement', 'forecast', 'budget', or 'other'
  'Profit and Loss statement for Q1 2024'
);
```

## Extending Company Values

Values can be updated in the database:

```sql
INSERT INTO company_values (name, description, keywords, examples)
VALUES (
  'Customer Focus',
  'Putting our learners first in every decision',
  '["customer", "learner", "user", "student", "experience"]',
  '["Responding quickly to learner feedback", "Making decisions based on learner outcomes"]'
);
```

## Security Considerations

- All credentials are stored as environment variables
- Service account has read-only access to Google documents
- Slack bot only has necessary permissions
- Database connections use SSL in production
- No sensitive data is logged

## Support

For issues or questions, contact the development team or check the logs in Railway dashboard.
