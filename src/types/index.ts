// Direct Reports
export interface DirectReport {
  id: string;
  name: string;
  slackUserId: string;
  email: string;
  role: string;
  employmentAgreementDocId?: string;
  alignmentConversationDocId?: string;
}

// Strategic Plan
export interface StrategicPlan {
  id: string;
  content: string;
  lastUpdated: Date;
  sections: StrategicPlanSection[];
}

export interface StrategicPlanSection {
  title: string;
  content: string;
  category: 'strategy' | 'leadership' | 'capital' | 'values';
}

// Financial Data
export interface FinancialData {
  id: string;
  sheetId: string;
  sheetName: string;
  data: Record<string, unknown>;
  lastUpdated: Date;
}

// Slack Messages
export interface SlackMessage {
  id: string;
  channelId: string;
  channelName: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: string;
  threadTs?: string;
  isDirectMessage: boolean;
  createdAt: Date;
}

// Conversation Context
export interface ConversationContext {
  userId: string;
  channelId: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  }>;
  lastActivity: Date;
}

// Pattern Recognition
export interface CommunicationPattern {
  id: string;
  type: 'topic' | 'sentiment' | 'urgency' | 'values_alignment';
  description: string;
  frequency: number;
  relevantMessages: string[];
  detectedAt: Date;
  recommendedAction?: string;
  relatedValue?: CompanyValue;
}

// Company Values
export interface CompanyValue {
  name: string;
  description: string;
  keywords: string[];
  examples: string[];
}

// Delegated Task
export interface DelegatedTask {
  id: string;
  directReportId: string;
  directReportName: string;
  instruction: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  conversationHistory: Array<{
    role: 'saim' | 'direct_report';
    message: string;
    timestamp: Date;
  }>;
  summary?: string;
  createdAt: Date;
  completedAt?: Date;
}

// CEO Responsibilities
export type CEOResponsibility = 'strategy' | 'leadership' | 'capital' | 'values';

export interface CEOGuidance {
  responsibility: CEOResponsibility;
  insight: string;
  suggestedAction: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  relatedData: {
    type: 'strategic_plan' | 'slack_message' | 'financial' | 'hr_doc';
    reference: string;
  }[];
}
