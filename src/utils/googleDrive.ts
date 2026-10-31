/**
 * Google Drive Client-Side Integration Module
 * Built using pure Google Cloud OAuth 2.0 (Google Identity Services & Web OAuth 2.0)
 * Completely independent of Firebase Authentication to ensure:
 * 1. OAuth origin displays "https://universal-media-document-studio-pro.vercel.app/" directly
 * 2. Never redirects to or displays "*.firebaseapp.com"
 * 3. Never asks for Firebase profile photo or email account transfer
 * 4. Requests strictly Google Drive scopes (https://www.googleapis.com/auth/drive.file)
 */

import firebaseConfig from '../../firebase-applet-config.json';

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

// Auto-handle OAuth popup redirect return if window was opened as OAuth callback
if (typeof window !== 'undefined' && window.location.hash) {
  try {
    const hash = window.location.hash;
    if (hash.includes('access_token=')) {
      const params = new URLSearchParams(hash.substring(1));
      const token = params.get('access_token');
      if (token) {
        cachedAccessToken = token;
        if (window.opener) {
          try {
            window.opener.postMessage({ type: 'GOOGLE_OAUTH_TOKEN', access_token: token }, '*');
            window.close();
          } catch (e) {}
        } else {
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
      }
    }
  } catch (e) {}
}

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

export class UnauthorizedDomainError extends Error {
  public readonly domain: string;
  public readonly projectId: string;
  public readonly cloudConsoleUrl: string;

  constructor(domain?: string, projectId?: string) {
    const d = domain || (typeof window !== 'undefined' ? window.location.origin : 'https://universal-media-document-studio-pro.vercel.app');
    const p = projectId || firebaseConfig.projectId || 'gen-lang-client-0684708643';
    super(
      `このURL (${d}) は Google Cloud の承認済みのJavaScript生成元に登録されていません。`
    );
    this.name = 'UnauthorizedDomainError';
    this.domain = d;
    this.projectId = p;
    this.cloudConsoleUrl = `https://console.cloud.google.com/apis/credentials?project=${p}`;
  }
}

export function isUnauthorizedDomainError(err: any): boolean {
  if (!err) return false;
  if (err instanceof UnauthorizedDomainError || err.name === 'UnauthorizedDomainError') return true;
  const msg = (err.message || '').toLowerCase();
  const code = (err.code || '').toLowerCase();
  const type = (err.type || '').toLowerCase();
  return (
    code.includes('auth/unauthorized-domain') ||
    msg.includes('unauthorized-domain') ||
    code.includes('origin_mismatch') ||
    msg.includes('origin_mismatch') ||
    type.includes('origin_mismatch') ||
    code.includes('redirect_uri_mismatch') ||
    msg.includes('redirect_uri_mismatch') ||
    code.includes('access_denied') ||
    msg.includes('access_denied') ||
    code.includes('idpiframe_initialization_failed') ||
    msg.includes('idpiframe_initialization_failed') ||
    code.includes('popup_blocked') ||
    type.includes('popup_failed') ||
    type.includes('popup_blocked') ||
    msg.includes('ポップアップがブロック') ||
    msg.includes('popup_blocked') ||
    msg.includes('popup blocked')
  );
}

/**
 * Request access token using Google Identity Services (GIS) token client.
 * Connects directly with Google Cloud OAuth without Firebase Auth intermediate redirects.
 */
export async function requestAccessTokenViaGis(): Promise<string> {
  const clientId = firebaseConfig.oAuthClientId;
  if (!clientId) {
    throw new Error('Google Cloud OAuth Client ID is not configured.');
  }

  return new Promise((resolve, reject) => {
    const initAndRequest = () => {
      try {
        const googleObj = (window as any).google;
        if (!googleObj?.accounts?.oauth2) {
          reject(new Error('Google Identity Services is not available.'));
          return;
        }

        const client = googleObj.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'https://www.googleapis.com/auth/drive.file',
          prompt: '',
          callback: (response: any) => {
            if (response.error) {
              const err = new Error(response.error_description || response.error);
              (err as any).code = response.error;
              reject(err);
            } else if (response.access_token) {
              resolve(response.access_token);
            } else {
              reject(new Error('No access token returned from Google Identity Services.'));
            }
          },
          error_callback: (err: any) => {
            const msg = err?.message || (typeof err === 'string' ? err : err?.type) || 'GIS Error';
            const error = new Error(msg);
            (error as any).code = err?.type || err?.error || 'gis_error';
            (error as any).type = err?.type || 'gis_error';
            reject(error);
          },
        });

        client.requestAccessToken({ prompt: 'consent' });
      } catch (e) {
        reject(e);
      }
    };

    if ((window as any).google?.accounts?.oauth2) {
      initAndRequest();
    } else {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        if ((window as any).google?.accounts?.oauth2) {
          initAndRequest();
        } else {
          reject(new Error('Google Identity Services loaded but oauth2 is unavailable.'));
        }
      };
      script.onerror = () => reject(new Error('Failed to load Google Identity Services.'));
      document.head.appendChild(script);
    }
  });
}

/**
 * Direct Google Cloud OAuth 2.0 Web Popup Flow.
 * Explicitly targets the current origin (e.g. https://universal-media-document-studio-pro.vercel.app/)
 * as redirect_uri so that Google displays the site's URL on the consent screen.
 */
export async function requestAccessTokenViaPopup(clientId: string): Promise<string> {
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://universal-media-document-studio-pro.vercel.app';
  const scope = encodeURIComponent('https://www.googleapis.com/auth/drive.file');
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
    clientId
  )}&redirect_uri=${encodeURIComponent(
    currentOrigin
  )}&response_type=token&scope=${scope}&prompt=select_account&include_granted_scopes=true`;

  return new Promise((resolve, reject) => {
    const width = 500;
    const height = 620;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      authUrl,
      'google_oauth_popup',
      `width=${width},height=${height},left=${left},top=${top},status=no,toolbar=no,menubar=no`
    );

    if (!popup) {
      const blockErr = new Error('ポップアップがブロックされました。ブラウザの設定でポップアップを許可するか、直接トークンを入力して接続してください。');
      (blockErr as any).code = 'popup_blocked';
      reject(blockErr);
      return;
    }

    let intervalId: any = null;

    const messageHandler = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_OAUTH_TOKEN' && event.data?.access_token) {
        cleanup();
        resolve(event.data.access_token);
      }
    };

    const cleanup = () => {
      window.removeEventListener('message', messageHandler);
      if (intervalId) clearInterval(intervalId);
    };

    window.addEventListener('message', messageHandler);

    intervalId = setInterval(() => {
      try {
        if (popup.closed) {
          cleanup();
          const closedErr = new Error('Popup closed by user');
          (closedErr as any).code = 'auth/popup-closed-by-user';
          reject(closedErr);
          return;
        }

        if (popup.location && popup.location.origin === window.location.origin) {
          const hash = popup.location.hash;
          if (hash && hash.includes('access_token=')) {
            const params = new URLSearchParams(hash.substring(1));
            const token = params.get('access_token');
            cleanup();
            popup.close();
            if (token) {
              resolve(token);
            } else {
              reject(new Error('No access token in response.'));
            }
          } else if (hash && hash.includes('error=')) {
            const params = new URLSearchParams(hash.substring(1));
            const err = params.get('error') || 'OAuth error';
            cleanup();
            popup.close();
            reject(new Error(err));
          }
        }
      } catch (e) {
        // Cross-origin access while still on accounts.google.com is expected
      }
    }, 300);
  });
}

/**
 * Manually set an OAuth access token (for custom domains, manual authorization, or offline tests)
 */
export async function setManualAccessToken(token: string): Promise<boolean> {
  const trimmed = token.trim();
  if (!trimmed) return false;
  cachedAccessToken = trimmed;
  try {
    const user = await fetchDriveUserInfo();
    if (user) {
      cachedDriveUser = user;
    }
  } catch (e) {
    console.warn('Error fetching user info for manual token:', e);
  }
  notifyListeners();
  return true;
}

/**
 * Request access token popup directly via Google Cloud OAuth (GIS or Web OAuth Popup)
 * Completely eliminates Firebase Auth and *.firebaseapp.com redirects.
 */
export async function requestGoogleAccessToken(
  onSuccess?: () => void,
  onError?: (err: any) => void
): Promise<string | null> {
  if (isSigningIn) return cachedAccessToken;

  isSigningIn = true;
  const clientId = firebaseConfig.oAuthClientId;

  try {
    let token: string | null = null;

    // 1. Primary: Google Identity Services (GIS)
    try {
      token = await requestAccessTokenViaGis();
    } catch (gisErr: any) {
      console.warn('GIS primary sign-in attempt notice:', gisErr);
      if (gisErr?.code === 'auth/popup-closed-by-user' || gisErr?.message?.includes('popup_closed') || gisErr?.type === 'popup_closed') {
        throw gisErr;
      }
      if (isUnauthorizedDomainError(gisErr)) {
        const currentDomain = typeof window !== 'undefined' ? window.location.origin : 'https://universal-media-document-studio-pro.vercel.app';
        throw new UnauthorizedDomainError(currentDomain, firebaseConfig.projectId);
      }
    }

    // 2. Secondary: Direct Google Cloud OAuth 2.0 Popup
    if (!token && clientId) {
      try {
        token = await requestAccessTokenViaPopup(clientId);
      } catch (popupErr: any) {
        console.warn('Direct popup flow notice:', popupErr);
        if (popupErr?.code === 'auth/popup-closed-by-user' || popupErr?.message?.includes('closed') || popupErr?.type === 'popup_closed') {
          throw popupErr;
        }
        if (isUnauthorizedDomainError(popupErr)) {
          const currentDomain = typeof window !== 'undefined' ? window.location.origin : 'https://universal-media-document-studio-pro.vercel.app';
          throw new UnauthorizedDomainError(currentDomain, firebaseConfig.projectId);
        }
        throw popupErr;
      }
    }

    if (!token) {
      const currentDomain = typeof window !== 'undefined' ? window.location.origin : 'https://universal-media-document-studio-pro.vercel.app';
      throw new UnauthorizedDomainError(currentDomain, firebaseConfig.projectId);
    }

    cachedAccessToken = token;
    await fetchDriveUserInfo();
    notifyListeners();
    if (onSuccess) onSuccess();
    return cachedAccessToken;
  } catch (err: any) {
    if (err?.code === 'auth/popup-closed-by-user' || err?.type === 'popup_closed') {
      console.warn('Google sign-in popup closed by user');
    } else {
      console.warn('Google sign-in diagnostic notice:', err?.message || err);
    }
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
  if (cachedAccessToken) {
    try {
      fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(cachedAccessToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }).catch(() => {});
    } catch (e) {}
  }
  cachedAccessToken = null;
  cachedDriveUser = null;
  appFolderId = null;
  notifyListeners();
}

/**
 * Fetch current Google Drive user information directly via Google Drive API
 */
export async function fetchDriveUserInfo(): Promise<DriveUser | null> {
  if (!cachedAccessToken) {
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
      cachedDriveUser = null;
      notifyListeners();
      return null;
    }
  } catch (e) {
    console.warn('Drive about fetch error:', e);
  }

  // Fallback to Google userinfo endpoint if available
  try {
    const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${cachedAccessToken}` },
    });
    if (userinfoRes.ok) {
      const info = await userinfoRes.json();
      cachedDriveUser = {
        displayName: info.name,
        emailAddress: info.email,
        photoLink: info.picture,
      };
      return cachedDriveUser;
    }
  } catch (e) {}

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

  // If folder parent caused error, retry upload to root
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
