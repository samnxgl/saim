import { getDocsClient } from './auth.js';
import { db, schema } from '../../db/index.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { desc, eq } from 'drizzle-orm';

export interface DocumentContent {
  documentId: string;
  title: string;
  content: string;
  lastModified?: string;
}

export async function fetchDocument(documentId: string): Promise<DocumentContent> {
  const docs = getDocsClient();

  try {
    const response = await docs.documents.get({
      documentId,
    });

    const document = response.data;
    const content = extractTextFromDocument(document);

    return {
      documentId,
      title: document.title || 'Untitled',
      content,
    };
  } catch (error) {
    logger.error('Failed to fetch Google Doc', { documentId, error });
    throw error;
  }
}

function extractTextFromDocument(document: any): string {
  const content: string[] = [];

  if (!document.body?.content) {
    return '';
  }

  for (const element of document.body.content) {
    if (element.paragraph) {
      const paragraphText = extractParagraphText(element.paragraph);
      if (paragraphText) {
        content.push(paragraphText);
      }
    } else if (element.table) {
      const tableText = extractTableText(element.table);
      if (tableText) {
        content.push(tableText);
      }
    }
  }

  return content.join('\n\n');
}

function extractParagraphText(paragraph: any): string {
  if (!paragraph.elements) {
    return '';
  }

  return paragraph.elements
    .map((element: any) => {
      if (element.textRun) {
        return element.textRun.content || '';
      }
      return '';
    })
    .join('');
}

function extractTableText(table: any): string {
  if (!table.tableRows) {
    return '';
  }

  const rows: string[] = [];

  for (const row of table.tableRows) {
    const cells: string[] = [];
    for (const cell of row.tableCells || []) {
      const cellContent: string[] = [];
      for (const content of cell.content || []) {
        if (content.paragraph) {
          cellContent.push(extractParagraphText(content.paragraph));
        }
      }
      cells.push(cellContent.join(' ').trim());
    }
    rows.push(cells.join(' | '));
  }

  return rows.join('\n');
}

export async function syncStrategicPlan(): Promise<DocumentContent> {
  logger.info('Syncing strategic plan document');

  const document = await fetchDocument(config.strategicPlanDocId);

  // Parse sections from the document
  const sections = parseStrategicPlanSections(document.content);

  // Store in database
  await db.insert(schema.strategicPlanVersions).values({
    docId: config.strategicPlanDocId,
    content: document.content,
    parsedSections: sections,
  });

  logger.info('Strategic plan synced successfully', {
    title: document.title,
    sectionsCount: sections.length,
  });

  return document;
}

function parseStrategicPlanSections(content: string): Array<{
  title: string;
  content: string;
  category: string;
}> {
  const sections: Array<{ title: string; content: string; category: string }> = [];

  // Split by common section headers (this may need adjustment based on actual document structure)
  const sectionPatterns = [
    { regex: /(?:^|\n)(Strategy|Strategic Direction|Vision|Mission)[:\s]*([\s\S]*?)(?=\n(?:Leadership|Capital|Values|Strategy|$))/gi, category: 'strategy' },
    { regex: /(?:^|\n)(Leadership|Team|Leadership Team|People)[:\s]*([\s\S]*?)(?=\n(?:Capital|Values|Strategy|Leadership|$))/gi, category: 'leadership' },
    { regex: /(?:^|\n)(Capital|Finance|Financial|Budget|Resources)[:\s]*([\s\S]*?)(?=\n(?:Values|Strategy|Leadership|Capital|$))/gi, category: 'capital' },
    { regex: /(?:^|\n)(Values|Standards|Culture|Principles)[:\s]*([\s\S]*?)(?=\n(?:Strategy|Leadership|Capital|Values|$))/gi, category: 'values' },
  ];

  for (const pattern of sectionPatterns) {
    let match;
    while ((match = pattern.regex.exec(content)) !== null) {
      sections.push({
        title: match[1].trim(),
        content: match[2].trim(),
        category: pattern.category,
      });
    }
  }

  // If no sections were parsed, treat entire content as a single section
  if (sections.length === 0) {
    sections.push({
      title: 'Strategic Plan',
      content: content,
      category: 'strategy',
    });
  }

  return sections;
}

export async function getLatestStrategicPlan(): Promise<{
  content: string;
  sections: Array<{ title: string; content: string; category: string }>;
  lastUpdated: Date;
} | null> {
  const [latest] = await db
    .select()
    .from(schema.strategicPlanVersions)
    .orderBy(desc(schema.strategicPlanVersions.createdAt))
    .limit(1);

  if (!latest) {
    return null;
  }

  return {
    content: latest.content,
    sections: (latest.parsedSections || []) as Array<{ title: string; content: string; category: string }>,
    lastUpdated: latest.createdAt,
  };
}

export async function fetchHRDocument(docId: string): Promise<DocumentContent> {
  return fetchDocument(docId);
}

export async function syncHRDocuments(): Promise<void> {
  logger.info('Syncing HR documents');

  const hrDocs = await db.select().from(schema.hrDocuments);

  for (const doc of hrDocs) {
    try {
      const content = await fetchDocument(doc.googleDocId);
      await db
        .update(schema.hrDocuments)
        .set({
          content: content.content,
          lastSynced: new Date(),
        })
        .where(eq(schema.hrDocuments.id, doc.id));
    } catch (error) {
      logger.error('Failed to sync HR document', { docId: doc.googleDocId, error });
    }
  }

  logger.info('HR documents sync completed');
}
