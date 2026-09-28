import React, { useRef, useState, useEffect } from 'react';
import { HardDrive, Upload, FolderUp } from 'lucide-react';
import { getStoredToken, getDriveUser, fetchDriveUserInfo, requestGoogleAccessToken, disconnectGoogleDrive, initGoogleIdentityServices, DriveUser } from '../utils/googleDrive';

interface CommonUploadCardProps {
  lang: 'ja' | 'en';
  onFilesSelected: (files: FileList | File[]) => void;
  onOpenDrivePicker: () => void;
  onShowToast: (msg: string) => void;
}

export const CommonUploadCard: React.FC<CommonUploadCardProps> = ({
  lang,
  onFilesSelected,
  onOpenDrivePicker,
  onShowToast,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const dropInputRef = useRef<HTMLInputElement>(null);
  const [isDropZoneDragging, setIsDropZoneDragging] = useState(false);
  const [driveUser, setDriveUser] = useState<DriveUser | null>(getDriveUser());
  const [isConnected, setIsConnected] = useState<boolean>(!!getStoredToken());

  useEffect(() => {
    initGoogleIdentityServices((token, user) => {
      setIsConnected(true);
      setDriveUser(user);
    });

    if (getStoredToken()) {
      fetchDriveUserInfo().then((user) => {
        if (user) {
          setIsConnected(true);
          setDriveUser(user);
        } else {
          setIsConnected(false);
          setDriveUser(null);
        }
      });
    }
  }, []);

  const handleConnectDrive = () => {
    requestGoogleAccessToken(() => {
      fetchDriveUserInfo().then((user) => {
        setIsConnected(true);
        setDriveUser(user);
        onShowToast(lang === 'ja' ? 'Google Driveと連携しました' : 'Connected to Google Drive');
      });
    });
  };

  const handleDisconnectDrive = () => {
    disconnectGoogleDrive();
    setIsConnected(false);
    setDriveUser(null);
    onShowToast(lang === 'ja' ? 'Google Driveの連携を解除しました' : 'Disconnected Google Drive');
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
        <label style={{ marginBottom: 0, fontWeight: 700 }}>
          {lang === 'ja' ? '1. 処理するファイルの読み込み・追加:' : '1. Add Files to Process:'}
        </label>
        <div id="driveAccountStatus" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem' }}>
          {isConnected && driveUser ? (
            <span id="driveStatusText" style={{ color: 'var(--text-sub)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#10b981' }}></span>
              <span>Drive: <strong style={{ color: 'var(--text-color)' }}>{driveUser.displayName || driveUser.emailAddress}</strong></span>
            </span>
          ) : (
            <span id="driveStatusText" style={{ color: 'var(--text-sub)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#94a3b8' }}></span>
              <span>{lang === 'ja' ? 'Google Drive: 未接続' : 'Google Drive: Disconnected'}</span>
            </span>
          )}

          {isConnected ? (
            <button
              onClick={handleDisconnectDrive}
              id="btnDriveDisconnect"
              className="btn-sm"
              style={{ padding: '2px 8px', fontSize: '0.72rem', cursor: 'pointer' }}
            >
              {lang === 'ja' ? '解除' : 'Disconnect'}
            </button>
          ) : (
            <button
              onClick={handleConnectDrive}
              id="btnDriveConnect"
              className="btn-sm"
              style={{ padding: '2px 8px', fontSize: '0.72rem', cursor: 'pointer' }}
            >
              {lang === 'ja' ? '連携' : 'Connect'}
            </button>
          )}
        </div>
      </div>

      <div className="upload-options">
        <div className="upload-btn" onClick={() => fileInputRef.current?.click()}>
          <span>{lang === 'ja' ? 'ファイルを選択 (複数可)' : 'Select Files'}</span>
          <input
            ref={fileInputRef}
            type="file"
            id="fileInput"
            multiple
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onFilesSelected(e.target.files);
              }
              e.target.value = '';
            }}
          />
        </div>

        <div className="upload-btn" onClick={() => folderInputRef.current?.click()}>
          <span>{lang === 'ja' ? 'フォルダを選択 (複数可)' : 'Select Folder'}</span>
          <input
            ref={folderInputRef}
            type="file"
            id="folderInput"
            // @ts-ignore
            webkitdirectory=""
            directory=""
            multiple
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onFilesSelected(e.target.files);
              }
              e.target.value = '';
            }}
          />
        </div>

        <div className="upload-btn upload-btn-cloud" id="btnDrivePicker" onClick={onOpenDrivePicker} style={{ cursor: 'pointer' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            <HardDrive className="w-4 h-4" />
            <span>{lang === 'ja' ? 'Google Driveから読込' : 'Google Drive Import'}</span>
          </span>
        </div>
      </div>

      <div
        id="dropZone"
        className={`drop-zone ${isDropZoneDragging ? 'dragover' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDropZoneDragging(true);
        }}
        onDragLeave={() => setIsDropZoneDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDropZoneDragging(false);
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            onFilesSelected(e.dataTransfer.files);
          }
        }}
        onClick={() => dropInputRef.current?.click()}
      >
        <span>{lang === 'ja' ? 'または、ここにファイル/フォルダをドラッグ＆ドロップ' : 'Or drag & drop files/folders here'}</span>
        <input
          ref={dropInputRef}
          type="file"
          id="dropInput"
          multiple
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onFilesSelected(e.target.files);
            }
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
};
