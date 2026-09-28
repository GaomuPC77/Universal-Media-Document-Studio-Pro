/**
 * Google Drive Client-Side Integration Module
 * Matches the reference Google Identity Services (GIS) and Drive API v3 architecture
 */

declare global {
  interface Window {
    google?: any;
  }
}

export interface DriveFileInfo {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  modifiedTime?: string;
  iconLink?: string;
}

export interface DriveUser {
  displayName?: string;
  emailAddress?: string;
  photoLink?: string;
}

let driveAccessToken: string | null = localStorage.getItem('gdrive_access_token') || null;
let driveUserInfo: DriveUser | null = null;
let tokenClient: any = null;
let appFolderId: string | null = null;

const DEFAULT_CLIENT_ID = '682605255020-1lc016je2t1lsacm1i4tr5247q3rfi0t.apps.googleusercontent.com';

export function getStoredToken(): string | null {
  return driveAccessToken;
}

export function getDriveUser(): DriveUser | null {
  return driveUserInfo;
}

/**
 * Initialize Google Identity Services (GIS)
 */
export async function initGoogleIdentityServices(
  onTokenReceived?: (token: string, user: DriveUser | null) => void,
  onError?: (err: any) => void
): Promise<void> {
  let clientId = DEFAULT_CLIENT_ID;

  try {
    const res = await fetch('/firebase-applet-config.json');
    if (res.ok) {
      const cfg = await res.json();
      if (cfg && cfg.oAuthClientId) clientId = cfg.oAuthClientId;
    }
  } catch (e) {}

  // Load GIS script if not present
  if (!window.google?.accounts?.oauth2) {
    if (!document.getElementById('google-gis-script')) {
      const script = document.createElement('script');
      script.id = 'google-gis-script';
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }

  const checkGisInterval = setInterval(() => {
    if (window.google?.accounts?.oauth2) {
      clearInterval(checkGisInterval);
      try {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly',
          callback: async (tokenResponse: any) => {
            if (tokenResponse.error) {
              console.error('GIS OAuth Error:', tokenResponse);
              if (onError) onError(tokenResponse);
              return;
            }
            driveAccessToken = tokenResponse.access_token;
            localStorage.setItem('gdrive_access_token', driveAccessToken!);
            const user = await fetchDriveUserInfo();
            if (onTokenReceived) onTokenReceived(driveAccessToken!, user);
          },
        });

        if (driveAccessToken) {
          fetchDriveUserInfo().then((user) => {
            if (onTokenReceived) onTokenReceived(driveAccessToken!, user);
          });
        }
      } catch (err) {
        console.error('GIS client init error:', err);
      }
    }
  }, 300);

  setTimeout(() => clearInterval(checkGisInterval), 10000);
}

/**
 * Request access token popup from Google
 */
export function requestGoogleAccessToken(onSuccess?: () => void): void {
  if (!tokenClient) {
    initGoogleIdentityServices(() => {
      if (tokenClient) tokenClient.requestAccessToken({ prompt: '' });
    });
    return;
  }
  tokenClient.requestAccessToken({ prompt: '' });
}

/**
 * Disconnect and revoke Drive access
 */
export function disconnectGoogleDrive(): void {
  if (driveAccessToken && window.google?.accounts?.oauth2?.revoke) {
    try {
      window.google.accounts.oauth2.revoke(driveAccessToken, () => {});
    } catch (e) {}
  }
  driveAccessToken = null;
  driveUserInfo = null;
  localStorage.removeItem('gdrive_access_token');
}

/**
 * Fetch current Google Drive user information
 */
export async function fetchDriveUserInfo(): Promise<DriveUser | null> {
  if (!driveAccessToken) return null;
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: { Authorization: `Bearer ${driveAccessToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      driveUserInfo = data.user;
      return driveUserInfo;
    } else if (res.status === 401) {
      driveAccessToken = null;
      driveUserInfo = null;
      localStorage.removeItem('gdrive_access_token');
    }
  } catch (e) {
    console.warn('Drive about check error:', e);
  }
  return null;
}

/**
 * Fetch files from Google Drive
 */
export async function fetchDriveFiles(searchQuery: string = ''): Promise<DriveFileInfo[]> {
  if (!driveAccessToken) {
    throw new Error('Google Drive is not connected');
  }

  const mimeFilters = [
    "mimeType contains 'pdf'",
    "mimeType contains 'document'",
    "mimeType contains 'sheet'",
    "mimeType contains 'text'",
    "mimeType contains 'image'",
    "mimeType contains 'video'",
    "mimeType contains 'audio'",
    "name contains '.pdf'",
    "name contains '.docx'",
    "name contains '.xlsx'",
    "name contains '.csv'",
    "name contains '.txt'",
    "name contains '.png'",
    "name contains '.jpg'",
    "name contains '.mp4'",
    "name contains '.mp3'",
  ].join(' or ');

  let q = `trashed = false and (${mimeFilters})`;
  if (searchQuery && searchQuery.trim()) {
    const safeQ = searchQuery.trim().replace(/'/g, "\\'");
    q = `trashed = false and name contains '${safeQ}' and (${mimeFilters})`;
  }

  const url = `https://www.googleapis.com/drive/v3/files?pageSize=100&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,iconLink)&q=${encodeURIComponent(
    q
  )}&orderBy=modifiedTime desc`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${driveAccessToken}` },
  });

  if (!res.ok) {
    if (res.status === 401) {
      driveAccessToken = null;
      localStorage.removeItem('gdrive_access_token');
      throw new Error('AUTH_EXPIRED');
    }
    throw new Error(`Drive API error: ${res.statusText}`);
  }

  const data = await res.json();
  return (data.files || []).map((f: any) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size ? parseInt(f.size, 10) : 0,
    modifiedTime: f.modifiedTime,
    iconLink: f.iconLink,
  }));
}

/**
 * Download single file from Google Drive into a File object
 */
export async function downloadDriveFile(fileInfo: DriveFileInfo): Promise<File> {
  if (!driveAccessToken) throw new Error('Not connected');

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileInfo.id}?alt=media`, {
    headers: { Authorization: `Bearer ${driveAccessToken}` },
  });

  if (!res.ok) throw new Error(`Download failed with status ${res.status}`);
  const blob = await res.blob();
  return new File([blob], fileInfo.name, {
    type: fileInfo.mimeType || 'application/octet-stream',
  });
}

/**
 * Get or create "Universal Document Studio" folder in Google Drive
 */
async function getOrCreateAppFolder(): Promise<string | null> {
  if (appFolderId) return appFolderId;
  if (!driveAccessToken) return null;

  try {
    const q = "name = 'Universal Document Studio' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${driveAccessToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.files && data.files.length > 0) {
        appFolderId = data.files[0].id;
        return appFolderId;
      }
    }

    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${driveAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Universal Document Studio',
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });
    if (createRes.ok) {
      const created = await createRes.json();
      appFolderId = created.id;
      return appFolderId;
    }
  } catch (e) {
    console.warn('Folder check/create error:', e);
  }
  return null;
}

/**
 * Upload a processed file buffer to Google Drive
 */
export async function uploadFileToDrive(
  fileName: string,
  mimeType: string,
  dataBuffer: ArrayBuffer | Uint8Array | Blob
): Promise<{ id: string; name: string; webViewLink?: string }> {
  if (!driveAccessToken) throw new Error('Google Drive is not connected');

  const folderId = await getOrCreateAppFolder();
  const metadata: any = {
    name: fileName,
    mimeType: mimeType || 'application/octet-stream',
  };
  if (folderId) {
    metadata.parents = [folderId];
  }

  const boundary = '-------314159265358979323846';
  const delimiter = '\r\n--' + boundary + '\r\n';
  const closeDelim = '\r\n--' + boundary + '--';

  const metaPart =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata);

  const filePartHeader = delimiter + `Content-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`;

  const metaBlob = new Blob([metaPart]);
  const fileHeaderBlob = new Blob([filePartHeader]);
  const dataBlob = dataBuffer instanceof Blob ? dataBuffer : new Blob([dataBuffer]);
  const closeBlob = new Blob([closeDelim]);

  const multipartBody = new Blob([metaBlob, fileHeaderBlob, dataBlob, closeBlob]);

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${driveAccessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  if (!uploadRes.ok) {
    throw new Error(`Drive upload failed: ${uploadRes.status} ${uploadRes.statusText}`);
  }

  return await uploadRes.json();
}
