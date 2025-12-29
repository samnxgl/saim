import { getDriveClient } from './auth.js';
import { logger } from '../../utils/logger.js';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink?: string;
}

export async function listFilesInFolder(folderId: string): Promise<DriveFile[]> {
  const drive = getDriveClient();

  try {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType, modifiedTime, webViewLink)',
      orderBy: 'modifiedTime desc',
    });

    return (response.data.files || []).map((file) => ({
      id: file.id || '',
      name: file.name || '',
      mimeType: file.mimeType || '',
      modifiedTime: file.modifiedTime || '',
      webViewLink: file.webViewLink || undefined,
    }));
  } catch (error) {
    logger.error('Failed to list files in folder', { folderId, error });
    throw error;
  }
}

export async function searchFiles(query: string): Promise<DriveFile[]> {
  const drive = getDriveClient();

  try {
    const response = await drive.files.list({
      q: `fullText contains '${query}' and trashed = false`,
      fields: 'files(id, name, mimeType, modifiedTime, webViewLink)',
      orderBy: 'modifiedTime desc',
      pageSize: 20,
    });

    return (response.data.files || []).map((file) => ({
      id: file.id || '',
      name: file.name || '',
      mimeType: file.mimeType || '',
      modifiedTime: file.modifiedTime || '',
      webViewLink: file.webViewLink || undefined,
    }));
  } catch (error) {
    logger.error('Failed to search files', { query, error });
    throw error;
  }
}

export async function getFileMetadata(fileId: string): Promise<DriveFile> {
  const drive = getDriveClient();

  try {
    const response = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType, modifiedTime, webViewLink',
    });

    return {
      id: response.data.id || '',
      name: response.data.name || '',
      mimeType: response.data.mimeType || '',
      modifiedTime: response.data.modifiedTime || '',
      webViewLink: response.data.webViewLink || undefined,
    };
  } catch (error) {
    logger.error('Failed to get file metadata', { fileId, error });
    throw error;
  }
}

export async function findDocumentsByName(
  namePattern: string,
  mimeType?: string
): Promise<DriveFile[]> {
  const drive = getDriveClient();

  try {
    let query = `name contains '${namePattern}' and trashed = false`;
    if (mimeType) {
      query += ` and mimeType = '${mimeType}'`;
    }

    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name, mimeType, modifiedTime, webViewLink)',
      orderBy: 'modifiedTime desc',
      pageSize: 50,
    });

    return (response.data.files || []).map((file) => ({
      id: file.id || '',
      name: file.name || '',
      mimeType: file.mimeType || '',
      modifiedTime: file.modifiedTime || '',
      webViewLink: file.webViewLink || undefined,
    }));
  } catch (error) {
    logger.error('Failed to find documents by name', { namePattern, error });
    throw error;
  }
}

export async function findEmploymentAgreements(): Promise<DriveFile[]> {
  return findDocumentsByName(
    'employment agreement',
    'application/vnd.google-apps.document'
  );
}

export async function findAlignmentConversations(): Promise<DriveFile[]> {
  return findDocumentsByName(
    'alignment',
    'application/vnd.google-apps.document'
  );
}
