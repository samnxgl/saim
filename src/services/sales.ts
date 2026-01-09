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

  // Try to extract amount - look for currency patterns
  const amountPatterns = [
    /\$\s*([\d,]+(?:\.\d{2})?)/,  // $1,234.56 or $100
    /(\d[\d,]*(?:\.\d{2})?)\s*(?:dollars?|usd)/i,  // 1234.56 dollars
    /(?:amount|total|paid|payment)[:\s]+\$?\s*([\d,]+(?:\.\d{2})?)/i,  // amount: $100
  ];

  let amount: number | null = null;
  for (const pattern of amountPatterns) {
    const match = text.match(pattern);
    if (match) {
      // Remove commas and parse
      amount = parseFloat(match[1].replace(/,/g, ''));
      break;
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
  ];

  const isDeposit = depositIndicators.some(indicator => lowerText.includes(indicator));

  // Also check if amount is exactly $100 (common deposit amount)
  if (isDeposit || amount === 100) {
    type = 'deposit';
  } else {
    type = 'full_payment';
  }

  // Try to extract customer name
  let customerName: string | undefined;
  const namePatterns = [
    /(?:from|customer|client|name)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:paid|deposited|sent)/,
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
