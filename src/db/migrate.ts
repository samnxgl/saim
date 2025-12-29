import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

async function migrate() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  const db = drizzle(pool);

  console.log('Running migrations...');

  try {
    // Create tables
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS direct_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        slack_user_id VARCHAR(50) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL,
        role VARCHAR(255) NOT NULL,
        employment_agreement_doc_id VARCHAR(255),
        alignment_conversation_doc_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS strategic_plan_versions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        doc_id VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        parsed_sections JSONB,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS financial_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sheet_id VARCHAR(255) NOT NULL,
        sheet_name VARCHAR(255) NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS slack_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slack_message_id VARCHAR(100) NOT NULL,
        channel_id VARCHAR(50) NOT NULL,
        channel_name VARCHAR(255),
        user_id VARCHAR(50) NOT NULL,
        user_name VARCHAR(255),
        text TEXT NOT NULL,
        timestamp VARCHAR(50) NOT NULL,
        thread_ts VARCHAR(50),
        is_direct_message BOOLEAN DEFAULT FALSE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_contexts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(50) NOT NULL,
        channel_id VARCHAR(50) NOT NULL,
        messages JSONB DEFAULT '[]' NOT NULL,
        last_activity TIMESTAMP DEFAULT NOW() NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS communication_patterns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type VARCHAR(50) NOT NULL,
        description TEXT NOT NULL,
        frequency INTEGER DEFAULT 1 NOT NULL,
        relevant_message_ids JSONB DEFAULT '[]' NOT NULL,
        recommended_action TEXT,
        related_value VARCHAR(100),
        is_addressed BOOLEAN DEFAULT FALSE NOT NULL,
        detected_at TIMESTAMP DEFAULT NOW() NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS delegated_tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        direct_report_id UUID NOT NULL REFERENCES direct_reports(id),
        instruction TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'pending' NOT NULL,
        conversation_history JSONB DEFAULT '[]' NOT NULL,
        summary TEXT,
        ceo_notified BOOLEAN DEFAULT FALSE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        completed_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS company_values (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL UNIQUE,
        description TEXT NOT NULL,
        keywords JSONB DEFAULT '[]' NOT NULL,
        examples JSONB DEFAULT '[]' NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ceo_guidance (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        responsibility VARCHAR(50) NOT NULL,
        insight TEXT NOT NULL,
        suggested_action TEXT NOT NULL,
        priority VARCHAR(20) NOT NULL,
        related_data JSONB DEFAULT '[]' NOT NULL,
        is_actioned BOOLEAN DEFAULT FALSE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hr_documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        direct_report_id UUID NOT NULL REFERENCES direct_reports(id),
        doc_type VARCHAR(50) NOT NULL,
        google_doc_id VARCHAR(255) NOT NULL,
        content TEXT,
        last_synced TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS financial_sheets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sheet_id VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        sheet_type VARCHAR(50) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_slack_messages_channel ON slack_messages(channel_id);
      CREATE INDEX IF NOT EXISTS idx_slack_messages_user ON slack_messages(user_id);
      CREATE INDEX IF NOT EXISTS idx_slack_messages_timestamp ON slack_messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_conversation_contexts_user_channel ON conversation_contexts(user_id, channel_id);
      CREATE INDEX IF NOT EXISTS idx_delegated_tasks_status ON delegated_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_communication_patterns_type ON communication_patterns(type);
    `);

    console.log('Migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

migrate().catch(console.error);
