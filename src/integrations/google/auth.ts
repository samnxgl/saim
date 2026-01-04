import { google } from 'googleapis';
import { config } from '../../config/index.js';

const SCOPES = [
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
];

export function getGoogleAuth() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: config.googleServiceAccountEmail,
      private_key: config.googlePrivateKey,
    },
    scopes: SCOPES,
  });

  return auth;
}

export function getDocsClient() {
  const auth = getGoogleAuth();
  return google.docs({ version: 'v1', auth });
}

export function getSheetsClient() {
  const auth = getGoogleAuth();
  return google.sheets({ version: 'v4', auth });
}

export function getDriveClient() {
  const auth = getGoogleAuth();
  return google.drive({ version: 'v3', auth });
}

export function getCalendarClient() {
  const auth = getGoogleAuth();
  return google.calendar({ version: 'v3', auth });
}
