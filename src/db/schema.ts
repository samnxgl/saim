import { pgTable, text, timestamp, boolean, jsonb, integer, uuid, varchar } from 'drizzle-orm/pg-core';

// Direct Reports table
export const directReports = pgTable('direct_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slackUserId: varchar('slack_user_id', { length: 50 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull(),
  role: varchar('role', { length: 255 }).notNull(),
  employmentAgreementDocId: varchar('employment_agreement_doc_id', { length: 255 }),
  alignmentConversationDocId: varchar('alignment_conversation_doc_id', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Strategic Plan versions
export const strategicPlanVersions = pgTable('strategic_plan_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  docId: varchar('doc_id', { length: 255 }).notNull(),
  content: text('content').notNull(),
  parsedSections: jsonb('parsed_sections').$type<{
    title: string;
    content: string;
    category: string;
  }[]>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Financial Data snapshots
export const financialSnapshots = pgTable('financial_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  sheetId: varchar('sheet_id', { length: 255 }).notNull(),
  sheetName: varchar('sheet_name', { length: 255 }).notNull(),
  data: jsonb('data').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Slack Messages archive
export const slackMessages = pgTable('slack_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  slackMessageId: varchar('slack_message_id', { length: 100 }).notNull(),
  channelId: varchar('channel_id', { length: 50 }).notNull(),
  channelName: varchar('channel_name', { length: 255 }),
  userId: varchar('user_id', { length: 50 }).notNull(),
  userName: varchar('user_name', { length: 255 }),
  text: text('text').notNull(),
  timestamp: varchar('timestamp', { length: 50 }).notNull(),
  threadTs: varchar('thread_ts', { length: 50 }),
  isDirectMessage: boolean('is_direct_message').default(false).notNull(),
  slackCreatedAt: timestamp('slack_created_at'), // Actual time the message was sent on Slack
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Conversation contexts for ongoing interactions
export const conversationContexts = pgTable('conversation_contexts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: varchar('user_id', { length: 50 }).notNull(),
  channelId: varchar('channel_id', { length: 50 }).notNull(),
  messages: jsonb('messages').$type<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
  }[]>().default([]).notNull(),
  lastActivity: timestamp('last_activity').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Detected communication patterns
export const communicationPatterns = pgTable('communication_patterns', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: varchar('type', { length: 50 }).notNull(),
  description: text('description').notNull(),
  frequency: integer('frequency').default(1).notNull(),
  relevantMessageIds: jsonb('relevant_message_ids').$type<string[]>().default([]).notNull(),
  recommendedAction: text('recommended_action'),
  relatedValue: varchar('related_value', { length: 100 }),
  isAddressed: boolean('is_addressed').default(false).notNull(),
  detectedAt: timestamp('detected_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Delegated tasks to direct reports
export const delegatedTasks = pgTable('delegated_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  directReportId: uuid('direct_report_id').references(() => directReports.id).notNull(),
  instruction: text('instruction').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  conversationHistory: jsonb('conversation_history').$type<{
    role: 'saim' | 'direct_report';
    message: string;
    timestamp: string;
  }[]>().default([]).notNull(),
  summary: text('summary'),
  ceoNotified: boolean('ceo_notified').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

// Company values reference
export const companyValues = pgTable('company_values', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: text('description').notNull(),
  keywords: jsonb('keywords').$type<string[]>().default([]).notNull(),
  examples: jsonb('examples').$type<string[]>().default([]).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// CEO Guidance/Insights generated
export const ceoGuidance = pgTable('ceo_guidance', {
  id: uuid('id').primaryKey().defaultRandom(),
  responsibility: varchar('responsibility', { length: 50 }).notNull(),
  insight: text('insight').notNull(),
  suggestedAction: text('suggested_action').notNull(),
  priority: varchar('priority', { length: 20 }).notNull(),
  relatedData: jsonb('related_data').$type<{
    type: string;
    reference: string;
  }[]>().default([]).notNull(),
  isActioned: boolean('is_actioned').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// HR Documents tracking
export const hrDocuments = pgTable('hr_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  directReportId: uuid('direct_report_id').references(() => directReports.id).notNull(),
  docType: varchar('doc_type', { length: 50 }).notNull(),
  googleDocId: varchar('google_doc_id', { length: 255 }).notNull(),
  content: text('content'),
  lastSynced: timestamp('last_synced'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Financial sheets tracking
export const financialSheets = pgTable('financial_sheets', {
  id: uuid('id').primaryKey().defaultRandom(),
  sheetId: varchar('sheet_id', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  sheetType: varchar('sheet_type', { length: 50 }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Outbound calls tracking
export const outboundCalls = pgTable('outbound_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  blandCallId: varchar('bland_call_id', { length: 100 }).notNull().unique(),
  phoneNumber: varchar('phone_number', { length: 50 }).notNull(),
  recipientName: varchar('recipient_name', { length: 255 }),
  task: text('task').notNull(),
  status: varchar('status', { length: 50 }).notNull().default('queued'),
  callLength: integer('call_length'), // in seconds
  recordingUrl: varchar('recording_url', { length: 500 }),
  transcript: text('transcript'),
  summary: text('summary'),
  analysis: jsonb('analysis').$type<Record<string, any>>(),
  errorMessage: text('error_message'),
  requestedBy: varchar('requested_by', { length: 50 }).notNull(), // Slack user ID
  slackChannelId: varchar('slack_channel_id', { length: 50 }),
  slackThreadTs: varchar('slack_thread_ts', { length: 50 }),
  notifiedCeo: boolean('notified_ceo').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
});
