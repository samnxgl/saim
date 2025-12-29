import { getSheetsClient } from './auth.js';
import { db, schema } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { eq, desc } from 'drizzle-orm';

export interface SheetData {
  sheetId: string;
  sheetName: string;
  headers: string[];
  rows: Record<string, string | number | null>[];
  rawData: (string | number | null)[][];
}

export async function fetchSheet(
  spreadsheetId: string,
  range?: string
): Promise<SheetData> {
  const sheets = getSheetsClient();

  try {
    // First get spreadsheet metadata
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    const sheetName = spreadsheet.data.sheets?.[0]?.properties?.title || 'Sheet1';
    const queryRange = range || `${sheetName}`;

    // Fetch data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: queryRange,
    });

    const values = response.data.values || [];

    if (values.length === 0) {
      return {
        sheetId: spreadsheetId,
        sheetName,
        headers: [],
        rows: [],
        rawData: [],
      };
    }

    // First row as headers
    const headers = values[0].map((h: any) => String(h));
    const rows = values.slice(1).map((row: any[]) => {
      const obj: Record<string, string | number | null> = {};
      headers.forEach((header: string, index: number) => {
        obj[header] = row[index] !== undefined ? row[index] : null;
      });
      return obj;
    });

    return {
      sheetId: spreadsheetId,
      sheetName,
      headers,
      rows,
      rawData: values,
    };
  } catch (error) {
    logger.error('Failed to fetch Google Sheet', { spreadsheetId, error });
    throw error;
  }
}

export async function fetchMultipleSheets(
  spreadsheetId: string
): Promise<SheetData[]> {
  const sheets = getSheetsClient();

  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId,
      includeGridData: false,
    });

    const sheetNames = spreadsheet.data.sheets?.map(
      (sheet) => sheet.properties?.title || 'Sheet1'
    ) || [];

    const results: SheetData[] = [];

    for (const sheetName of sheetNames) {
      const data = await fetchSheet(spreadsheetId, sheetName);
      results.push(data);
    }

    return results;
  } catch (error) {
    logger.error('Failed to fetch multiple sheets', { spreadsheetId, error });
    throw error;
  }
}

export async function syncFinancialSheet(
  spreadsheetId: string,
  sheetName: string
): Promise<void> {
  logger.info('Syncing financial sheet', { spreadsheetId, sheetName });

  try {
    const sheetData = await fetchSheet(spreadsheetId, sheetName);

    await db.insert(schema.financialSnapshots).values({
      sheetId: spreadsheetId,
      sheetName: sheetData.sheetName,
      data: {
        headers: sheetData.headers,
        rows: sheetData.rows,
        fetchedAt: new Date().toISOString(),
      },
    });

    logger.info('Financial sheet synced', { spreadsheetId, sheetName });
  } catch (error) {
    logger.error('Failed to sync financial sheet', { spreadsheetId, sheetName, error });
    throw error;
  }
}

export async function syncAllFinancialSheets(): Promise<void> {
  logger.info('Syncing all financial sheets');

  const financialSheets = await db
    .select()
    .from(schema.financialSheets)
    .where(eq(schema.financialSheets.isActive, true));

  for (const sheet of financialSheets) {
    try {
      await syncFinancialSheet(sheet.sheetId, sheet.name);
    } catch (error) {
      logger.error('Failed to sync financial sheet', { sheetId: sheet.sheetId, error });
    }
  }

  logger.info('Financial sheets sync completed');
}

export async function getLatestFinancialData(): Promise<
  Array<{
    sheetId: string;
    sheetName: string;
    data: any;
    createdAt: Date;
  }>
> {
  // Get the most recent snapshot for each sheet
  const snapshots = await db
    .select()
    .from(schema.financialSnapshots)
    .orderBy(desc(schema.financialSnapshots.createdAt));

  // Deduplicate by sheetId, keeping only the most recent
  const latestBySheet = new Map<string, typeof snapshots[0]>();
  for (const snapshot of snapshots) {
    if (!latestBySheet.has(snapshot.sheetId)) {
      latestBySheet.set(snapshot.sheetId, snapshot);
    }
  }

  return Array.from(latestBySheet.values()).map((s) => ({
    sheetId: s.sheetId,
    sheetName: s.sheetName,
    data: s.data,
    createdAt: s.createdAt,
  }));
}

export async function registerFinancialSheet(
  sheetId: string,
  name: string,
  sheetType: 'statement' | 'forecast' | 'budget' | 'other',
  description?: string
): Promise<void> {
  await db.insert(schema.financialSheets).values({
    sheetId,
    name,
    sheetType,
    description,
  }).onConflictDoNothing();

  logger.info('Financial sheet registered', { sheetId, name, sheetType });
}
