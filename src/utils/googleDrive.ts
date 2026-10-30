/**
 * Google Drive Client-Side Integration Module
 * Built using Firebase Authentication with GoogleAuthProvider and Google Drive API v3
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App & Auth
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

// Provider with Drive file scope
const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.file');
provider.setCustomParameters({ prompt: 'select_account' });

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

// In-memory token cache (never stored in localStorage/sessionStorage per security guidelines)
let cachedAccessToken: string | null = null;
let cachedDriveUser: DriveUser | null = null;
let appFolderId: string | null = null;
let isSigningIn = false;

type AuthListener = (token: string | null, user: DriveUser | null) => void;
const authListeners: Set<AuthListener> = new Set();

function notifyListeners() {
  for (const listener of authListeners) {
    try {
      listener(cachedAccessToken, cachedDriveUser);
    } catch (e) {
      console.error('Error in auth listener:', e);
    }
  }
}

// Listen to Firebase Auth state
onAuthStateChanged(auth, async (user: User | null) => {
  if (user) {
    if (!cachedDriveUser) {
      cachedDriveUser = {
        displayName: user.displayName || undefined,
        emailAddress: user.email || undefined,
        photoLink: user.photoURL || undefined,
      };
    }
  } else {
    cachedAccessToken = null;
    cachedDriveUser = null;
    appFolderId = null;
  }
  notifyListeners();
});

export function getStoredToken(): string | null {
  return cachedAccessToken;
}

export function getDriveUser(): DriveUser | null {
  return cachedDriveUser;
}

export function isDriveConnected(): boolean {
  return Boolean(cachedAccessToken);
}

/**
 * Initialize Google Drive auth listener
 */
export function initGoogleIdentityServices(
  onTokenReceived?: (token: string, user: DriveUser | null) => void,
  onError?: (err: any) => void
): () => void {
  const listener: AuthListener = (token, user) => {
    if (token) {
      if (onTokenReceived) onTokenReceived(token, user);
    }
  };

  authListeners.add(listener);

  if (cachedAccessToken) {
    if (onTokenReceived) onTokenReceived(cachedAccessToken, cachedDriveUser);
  }

  return () => {
    authListeners.delete(listener);
  };
}

/**
 * Request access token popup from Google via Firebase Auth
 */
export async function requestGoogleAccessToken(
  onSuccess?: () => void,
  onError?: (err: any) => void
): Promise<string | null> {
  if (isSigningIn) return cachedAccessToken;

  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google Drive access token was not returned.');
    }

    cachedAccessToken = credential.accessToken;
    cachedDriveUser = {
      displayName: result.user.displayName || undefined,
      emailAddress: result.user.email || undefined,
      photoLink: result.user.photoURL || undefined,
    };

    // Fetch detailed user info in background
    fetchDriveUserInfo().catch(() => {});

    notifyListeners();
    if (onSuccess) onSuccess();
    return cachedAccessToken;
  } catch (err: any) {
    console.error('Google Sign-in Error:', err);
    if (onError) onError(err);
    throw err;
  } finally {
    isSigningIn = false;
  }
}

/**
 * Disconnect and revoke Drive access
 */
export async function disconnectGoogleDrive(): Promise<void> {
  try {
    await signOut(auth);
  } catch (e) {
    console.warn('Sign out error:', e);
  }
  cachedAccessToken = null;
  cachedDriveUser = null;
  appFolderId = null;
  notifyListeners();
}

/**
 * Fetch current Google Drive user information
 */
export async function fetchDriveUserInfo(): Promise<DriveUser | null> {
  if (!cachedAccessToken) {
    if (auth.currentUser) {
      cachedDriveUser = {
        displayName: auth.currentUser.displayName || undefined,
        emailAddress: auth.currentUser.email || undefined,
        photoLink: auth.currentUser.photoURL || undefined,
      };
      return cachedDriveUser;
    }
    return null;
  }

  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: { Authorization: `Bearer ${cachedAccessToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.user) {
        cachedDriveUser = {
          displayName: data.user.displayName,
          emailAddress: data.user.emailAddress,
          photoLink: data.user.photoLink,
        };
        return cachedDriveUser;
      }
    } else if (res.status === 401) {
      cachedAccessToken = null;
      notifyListeners();
    }
  } catch (e) {
    console.warn('Drive about fetch error:', e);
  }

  return cachedDriveUser;
}

/**
 * Fetch files from Google Drive
 */
export async function fetchDriveFiles(searchQuery: string = ''): Promise<DriveFileInfo[]> {
  if (!cachedAccessToken) {
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
    headers: { Authorization: `Bearer ${cachedAccessToken}` },
  });

  if (!res.ok) {
    if (res.status === 401) {
      cachedAccessToken = null;
      notifyListeners();
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
  if (!cachedAccessToken) throw new Error('Not connected');

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileInfo.id}?alt=media`, {
    headers: { Authorization: `Bearer ${cachedAccessToken}` },
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
  if (!cachedAccessToken) return null;

  try {
    const q = "name = 'Universal Document Studio' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${cachedAccessToken}` },
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
        Authorization: `Bearer ${cachedAccessToken}`,
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
  if (!cachedAccessToken) throw new Error('Google Drive is not connected');

  let folderId: string | null = null;
  try {
    folderId = await getOrCreateAppFolder();
  } catch (err) {
    console.warn('Could not retrieve folder, uploading to root:', err);
  }

  const metadata: Record<string, any> = {
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

  let uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cachedAccessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  // If folder parent caused error (e.g., 404 or folder not writable), retry upload to root
  if (!uploadRes.ok && folderId) {
    console.warn('Upload with parent folder failed, retrying upload to root directory...');
    delete metadata.parents;
    const retryMetaPart =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata);
    const retryMultipartBody = new Blob([new Blob([retryMetaPart]), fileHeaderBlob, dataBlob, closeBlob]);
    uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cachedAccessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: retryMultipartBody,
      }
    );
  }

  if (!uploadRes.ok) {
    if (uploadRes.status === 401) {
      cachedAccessToken = null;
      notifyListeners();
    }
    const errText = await uploadRes.text().catch(() => '');
    throw new Error(`Drive upload failed (${uploadRes.status}): ${errText || uploadRes.statusText}`);
  }

  return await uploadRes.json();
}
