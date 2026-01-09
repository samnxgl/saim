import { logger } from '../utils/logger.js';
import {
  findChannelByName,
  getWebClient,
} from '../integrations/slack/client.js';

const BILLING_CHANNEL_NAME = 'billing';

export interface Transaction {
  type: 'deposit' | 'full_payment';
  amount: number;
  timestamp: string;
  userId?: string;
  text: string;
  customerName?: string;
}

export interface SalesResult {
  totalTransactions: number;
  totalValue: number;
  deposits: {
    count: number;
    value: number;
  };
  fullPayments: {
    count: number;
    value: number;
  };
  transactions: Transaction[];
  period?: string;
}

/**
 * Extract transaction details from a Slack message
 */
function extractTransactionFromMessage(text: string): Transaction | null {
  const lowerText = text.toLowerCase();

  // Skip bot messages that aren't transaction notifications
  if (lowerText.includes('error') || lowerText.includes('failed') || lowerText.includes('declined')) {
    return null;
  }

  // Try to extract amount - look for currency patterns (most specific to least)
  const amountPatterns = [
    /\$\s*([\d,]+(?:\.\d{2})?)/g,  // $1,234.56 or $100 - use global to find all
    /(?:amount|total|paid|payment|received|charge)[:\s]*\$?\s*([\d,]+(?:\.\d{2})?)/gi,
    /(\d[\d,]*(?:\.\d{2})?)\s*(?:dollars?|usd)/gi,
    /(?:for|of)\s+\$?\s*([\d,]+(?:\.\d{2})?)/gi,
  ];

  let amount: number | null = null;

  // Try each pattern
  for (const pattern of amountPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const parsed = parseFloat(match[1].replace(/,/g, ''));
      // Take the first valid amount we find (usually the transaction amount)
      if (parsed > 0) {
        amount = parsed;
        break;
      }
    }
    if (amount !== null) break;
  }

  // If still no amount, try to find any number that looks like money (3+ digits or has decimals)
  if (amount === null) {
    const genericMatch = text.match(/(\d{3,}(?:\.\d{2})?|\d+\.\d{2})/);
    if (genericMatch) {
      const parsed = parseFloat(genericMatch[1].replace(/,/g, ''));
      if (parsed >= 50) {  // Assume transactions are at least $50
        amount = parsed;
      }
    }
  }

  if (amount === null || amount <= 0) {
    return null;
  }

  // Determine transaction type
  let type: 'deposit' | 'full_payment';

  // Check for deposit indicators
  const depositIndicators = [
    'deposit',
    'down payment',
    'downpayment',
    'partial',
    'initial payment',
    'booking fee',
    'reservation',
    'holding',
  ];

  const fullPaymentIndicators = [
    'full payment',
    'balance',
    'remaining',
    'final payment',
    'paid in full',
    'complete payment',
  ];

  const isDeposit = depositIndicators.some(indicator => lowerText.includes(indicator));
  const isFullPayment = fullPaymentIndicators.some(indicator => lowerText.includes(indicator));

  // Determine type based on indicators and amount
  if (isFullPayment) {
    type = 'full_payment';
  } else if (isDeposit || amount === 100) {
    type = 'deposit';
  } else {
    // Default: amounts over $100 are likely full payments
    type = amount > 100 ? 'full_payment' : 'deposit';
  }

  // Try to extract customer name (more flexible patterns)
  let customerName: string | undefined;
  const namePatterns = [
    /(?:from|customer|client|name|by)[:\s]+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/,
    /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s+(?:paid|deposited|sent|made)/,
    /(?:payment|deposit)\s+(?:from|by)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/i,
  ];

  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match) {
      customerName = match[1];
      break;
    }
  }

  return {
    type,
    amount,
    timestamp: '',
    text,
    customerName,
  };
}

/**
 * Fetch all transactions from the billing channel
 */
export async function fetchAllTransactions(options?: {
  oldest?: Date;
  latest?: Date;
  limit?: number;
}): Promise<Transaction[]> {
  const channelId = await findChannelByName(BILLING_CHANNEL_NAME);

  if (!channelId) {
    logger.error('Billing channel not found', { channelName: BILLING_CHANNEL_NAME });
    throw new Error(`Could not find channel #${BILLING_CHANNEL_NAME}`);
  }

  const transactions: Transaction[] = [];
  let cursor: string | undefined;
  const client = getWebClient();
  const maxMessages = options?.limit || 1000;

  // Convert dates to Slack timestamps
  const oldest = options?.oldest
    ? (options.oldest.getTime() / 1000).toString()
    : undefined;
  const latest = options?.latest
    ? (options.latest.getTime() / 1000).toString()
    : undefined;

  try {
    // Paginate through all messages
    do {
      const result = await client.conversations.history({
        channel: channelId,
        limit: Math.min(200, maxMessages - transactions.length),
        cursor,
        oldest,
        latest,
      });

      for (const message of result.messages || []) {
        if (!message.text) continue;

        const transaction = extractTransactionFromMessage(message.text);
        if (transaction) {
          transaction.timestamp = message.ts || '';
          transaction.userId = message.user;
          transactions.push(transaction);
        }
      }

      cursor = result.response_metadata?.next_cursor;
    } while (cursor && transactions.length < maxMessages);

    logger.info('Fetched transactions', {
      channelId,
      totalTransactions: transactions.length,
    });

    return transactions;
  } catch (error) {
    logger.error('Failed to fetch transactions', { error });
    throw error;
  }
}

/**
 * Calculate sales totals from transactions
 */
export function calculateSales(transactions: Transaction[]): SalesResult {
  if (transactions.length === 0) {
    return {
      totalTransactions: 0,
      totalValue: 0,
      deposits: { count: 0, value: 0 },
      fullPayments: { count: 0, value: 0 },
      transactions: [],
    };
  }

  let depositCount = 0;
  let depositValue = 0;
  let fullPaymentCount = 0;
  let fullPaymentValue = 0;

  for (const transaction of transactions) {
    if (transaction.type === 'deposit') {
      depositCount++;
      depositValue += transaction.amount;
    } else {
      fullPaymentCount++;
      fullPaymentValue += transaction.amount;
    }
  }

  return {
    totalTransactions: transactions.length,
    totalValue: depositValue + fullPaymentValue,
    deposits: {
      count: depositCount,
      value: depositValue,
    },
    fullPayments: {
      count: fullPaymentCount,
      value: fullPaymentValue,
    },
    transactions,
  };
}

/**
 * Get the latest sales data
 */
export async function getLatestSales(options?: {
  days?: number;
}): Promise<SalesResult> {
  const days = options?.days;
  let oldest: Date | undefined;

  if (days) {
    oldest = new Date();
    oldest.setDate(oldest.getDate() - days);
    oldest.setHours(0, 0, 0, 0);
  }

  const transactions = await fetchAllTransactions({ oldest });
  const result = calculateSales(transactions);

  if (days) {
    result.period = `last ${days} days`;
  } else {
    result.period = 'all time';
  }

  return result;
}

/**
 * Get sales data for yesterday only
 */
export async function getYesterdaySales(): Promise<SalesResult> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const endOfYesterday = new Date(yesterday);
  endOfYesterday.setHours(23, 59, 59, 999);

  const transactions = await fetchAllTransactions({
    oldest: yesterday,
    latest: endOfYesterday,
  });

  const result = calculateSales(transactions);
  result.period = 'yesterday';

  return result;
}

/**
 * Format sales result for Slack display
 */
export function formatSalesForSlack(result: SalesResult): string {
  const {
    totalTransactions,
    totalValue,
    deposits,
    fullPayments,
    period,
  } = result;

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

  let response = `**💰 Sales Summary**\n\n`;
  response += `📅 **Period:** ${period || 'All time'}\n\n`;

  response += `**Totals:**\n`;
  response += `• Total Transactions: ${totalTransactions}\n`;
  response += `• Total Value: ${formatCurrency(totalValue)}\n\n`;

  response += `**Breakdown:**\n`;
  response += `• Deposits ($100): ${deposits.count} transactions (${formatCurrency(deposits.value)})\n`;
  response += `• Full Payments: ${fullPayments.count} transactions (${formatCurrency(fullPayments.value)})\n`;

  // Calculate conversion rate if we have deposits
  if (deposits.count > 0) {
    const conversionRate = (fullPayments.count / deposits.count) * 100;
    response += `\n📊 **Deposit to Full Payment Rate:** ${conversionRate.toFixed(1)}%`;
  }

  return response;
}
