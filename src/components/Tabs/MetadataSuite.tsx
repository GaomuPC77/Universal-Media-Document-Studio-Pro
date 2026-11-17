import React, { useState, useEffect, useRef, useMemo } from 'react';
import JSZip from 'jszip';
import {
  FileSearch,
  Upload,
  Download,
  Trash2,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  Calendar,
  Tag,
  Check,
  AlertTriangle,
  RefreshCw,
  FolderArchive,
  Search,
  Eraser,
  ExternalLink,
  FileText,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { FileItem, DocumentFormat } from '../../types';
import {
  InspectedMetadata,
  MetadataEditOptions,
  inspectFileMetadata,
  applyMetadataChanges,
  formatToDateTimeLocalInput,
  exifDateToDateTimeLocal,
  splitFileName,
} from '../../utils/metadataUtils';
import { getMetadataFieldGuide } from '../../utils/metadataGuide';
import { saveProcessedFile } from '../../utils/historyDb';
import { notifyCompletion } from '../../utils/notification';
import { AddToQueuePromptModal } from '../Modals/AddToQueuePromptModal';

interface MetadataSuiteProps {
  lang: 'ja' | 'en';
  sharedFile?: File | null;
  fileList?: FileItem[];
  onResultReady?: (item: FileItem) => void;
  onShowToast?: (msg: string) => void;
  onAddFiles?: (files: File[]) => void;
}

interface LocalFileEntry {
  id: string;
  file: File;
  inspected?: InspectedMetadata;
  isInspecting?: boolean;
  error?: string;
}

export const MetadataSuite: React.FC<MetadataSuiteProps> = ({
  lang,
  sharedFile,
  fileList = [],
  onResultReady,
  onShowToast,
  onAddFiles,
}) => {
  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [entries, setEntries] = useState<LocalFileEntry[]>([]);
  const [selectedSingleId, setSelectedSingleId] = useState<string>('');
  const [singleSection, setSingleSection] = useState<'basic' | 'gps' | 'c2pa' | 'tags'>('basic');
  const [pendingPromptFiles, setPendingPromptFiles] = useState<File[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Single File Edit State
  const [editBaseName, setEditBaseName] = useState('');
  const [editExt, setEditExt] = useState('');
  const [lastModAction, setLastModAction] = useState<'keep' | 'set' | 'reset'>('keep');
  const [editLastModStr, setEditLastModStr] = useState('');
  const [embeddedDateAction, setEmbeddedDateAction] = useState<'keep' | 'set' | 'delete'>('keep');
  const [editEmbeddedDateStr, setEditEmbeddedDateStr] = useState('');

  const [gpsAction, setGpsAction] = useState<'keep' | 'set' | 'delete'>('keep');
  const [editLat, setEditLat] = useState('');
  const [editLng, setEditLng] = useState('');
  const [editAlt, setEditAlt] = useState('');

  const [c2paAction, setC2paAction] = useState<'keep' | 'delete'>('keep');
  const [showC2paRaw, setShowC2paRaw] = useState(false);

  const [docMetaAction, setDocMetaAction] = useState<'keep' | 'set' | 'delete'>('keep');
  const [editTitle, setEditTitle] = useState('');
  const [editAuthor, setEditAuthor] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [editKeywords, setEditKeywords] = useState('');
  const [editSoftware, setEditSoftware] = useState('');
  const [editCopyright, setEditCopyright] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCompany, setEditCompany] = useState('');

  const [preserveIccAndOrientation, setPreserveIccAndOrientation] = useState(true);
  const [deletedTagIds, setDeletedTagIds] = useState<Set<string>>(new Set());
  const [editedTagValues, setEditedTagValues] = useState<Record<string, string>>({});
  const [tagGroupFilter, setTagGroupFilter] = useState<string>('ALL');
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  const [isProcessingSingle, setIsProcessingSingle] = useState(false);

  // Batch Mode State
  const [batchSelectedIds, setBatchSelectedIds] = useState<Set<string>>(new Set());
  const [batchRenameMode, setBatchRenameMode] = useState<'keep' | 'affix' | 'sequential' | 'anonymize'>('keep');
  const [batchPrefix, setBatchPrefix] = useState('');
  const [batchSuffix, setBatchSuffix] = useState('_clean');
  const [batchFind, setBatchFind] = useState('');
  const [batchReplace, setBatchReplace] = useState('');
  const [batchSeqBase, setBatchSeqBase] = useState('file_');

  const [batchExtMode, setBatchExtMode] = useState<'keep' | 'set' | 'lowercase' | 'autofix' | 'remove'>('keep');
  const [batchExtValue, setBatchExtValue] = useState('');

  const [batchLastModAction, setBatchLastModAction] = useState<'keep' | 'set' | 'shift' | 'reset'>('keep');
  const [batchLastModStr, setBatchLastModStr] = useState(formatToDateTimeLocalInput(Date.now()));
  const [batchShiftHours, setBatchShiftHours] = useState('0');

  const [batchEmbeddedDateAction, setBatchEmbeddedDateAction] = useState<'keep' | 'set' | 'delete'>('keep');
  const [batchEmbeddedDateStr, setBatchEmbeddedDateStr] = useState(formatToDateTimeLocalInput(Date.now()));

  const [batchGpsAction, setBatchGpsAction] = useState<'keep' | 'delete' | 'set'>('keep');
  const [batchLat, setBatchLat] = useState('');
  const [batchLng, setBatchLng] = useState('');

  const [batchC2paAction, setBatchC2paAction] = useState<'keep' | 'delete'>('keep');
  const [batchDocMetaMode, setBatchDocMetaMode] = useState<'keep' | 'delete-personal' | 'scrub-all'>('keep');
  const [batchPreserveIcc, setBatchPreserveIcc] = useState(true);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);

  // Sync incoming files from global fileList without duplicating already inspected entries
  useEffect(() => {
    const incoming = fileList.filter((item) => item.file);
    if (incoming.length === 0) return;

    setEntries((prev) => {
      const existingIds = new Set(prev.map((e) => e.id));
      const newOnes: LocalFileEntry[] = [];
      for (const item of incoming) {
        if (!existingIds.has(item.id)) {
          newOnes.push({ id: item.id, file: item.file, isInspecting: false });
        }
      }
      if (newOnes.length === 0) return prev;
      return [...prev, ...newOnes];
    });
  }, [fileList]);

  // Also ensure sharedFile is selected if available
  useEffect(() => {
    if (sharedFile && entries.length > 0 && !selectedSingleId) {
      const match = entries.find((e) => e.file === sharedFile || (e.file.name === sharedFile.name && e.file.size === sharedFile.size));
      if (match) {
        setSelectedSingleId(match.id);
      } else {
        setSelectedSingleId(entries[0].id);
      }
    } else if (entries.length > 0 && !entries.some((e) => e.id === selectedSingleId)) {
      setSelectedSingleId(entries[0].id);
    }
  }, [entries, sharedFile, selectedSingleId]);

  // Automatically inspect any uninspected entries
  useEffect(() => {
    const uninspected = entries.filter((e) => !e.inspected && !e.isInspecting && !e.error);
    if (uninspected.length === 0) return;

    uninspected.forEach(async (entry) => {
      setEntries((prev) => prev.map((p) => (p.id === entry.id ? { ...p, isInspecting: true } : p)));
      try {
        const meta = await inspectFileMetadata(entry.file);
        setEntries((prev) =>
          prev.map((p) => (p.id === entry.id ? { ...p, inspected: meta, isInspecting: false } : p))
        );
        setBatchSelectedIds((prev) => {
          const next = new Set(prev);
          next.add(entry.id);
          return next;
        });
      } catch (err: any) {
        setEntries((prev) =>
          prev.map((p) =>
            p.id === entry.id
              ? { ...p, isInspecting: false, error: err?.message || 'Inspection failed' }
              : p
          )
        );
      }
    });
  }, [entries]);

  const activeEntry = useMemo(
    () => entries.find((e) => e.id === selectedSingleId) || entries[0] || null,
    [entries, selectedSingleId]
  );

  // Sync single-file form inputs whenever activeEntry's inspected metadata changes
  useEffect(() => {
    if (!activeEntry?.inspected) return;
    const meta = activeEntry.inspected;
    setEditBaseName(meta.baseName);
    setEditExt(meta.nameExtension);
    setLastModAction('keep');
    setEditLastModStr(meta.lastModifiedInput);

    const embStr =
      exifDateToDateTimeLocal(meta.embeddedDates.original) ||
      exifDateToDateTimeLocal(meta.embeddedDates.created) ||
      exifDateToDateTimeLocal(meta.embeddedDates.modified) ||
      meta.lastModifiedInput;
    setEmbeddedDateAction('keep');
    setEditEmbeddedDateStr(embStr);

    setGpsAction('keep');
    setEditLat(meta.gps.latitude !== undefined ? meta.gps.latitude.toFixed(6) : '');
    setEditLng(meta.gps.longitude !== undefined ? meta.gps.longitude.toFixed(6) : '');
    setEditAlt(meta.gps.altitude !== undefined ? String(Math.round(meta.gps.altitude * 10) / 10) : '');

    setC2paAction('keep');
    setDocMetaAction('keep');
    setEditTitle(meta.documentMeta.title || '');
    setEditAuthor(meta.documentMeta.author || '');
    setEditSubject(meta.documentMeta.subject || '');
    setEditKeywords(meta.documentMeta.keywords || '');
    setEditSoftware(meta.documentMeta.software || '');
    setEditCopyright(meta.documentMeta.copyright || '');
    setEditDescription(meta.documentMeta.description || '');
    setEditCompany(meta.documentMeta.company || '');
    setDeletedTagIds(new Set());
    setEditedTagValues({});
    setTagGroupFilter('ALL');
  }, [activeEntry?.id, activeEntry?.inspected]);

  const handleLocalFilesUploaded = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    if (onAddFiles && arr.length === 1) {
      setPendingPromptFiles(arr);
    } else if (onAddFiles) {
      onAddFiles(arr);
      if (onShowToast) {
        onShowToast(lang === 'ja' ? `${arr.length}件のファイルを読み込みました` : `Loaded ${arr.length} files`);
      }
    } else {
      addLocalOnlyEntries(arr);
    }
  };

  const addLocalOnlyEntries = (files: File[]) => {
    const newEntries: LocalFileEntry[] = files.map((f, idx) => ({
      id: `meta_local_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      file: f,
      isInspecting: false,
    }));
    setEntries((prev) => [...newEntries, ...prev]);
    if (newEntries[0]) setSelectedSingleId(newEntries[0].id);
  };

  const handleReinspect = async (entryId: string) => {
    const target = entries.find((e) => e.id === entryId);
    if (!target) return;
    setEntries((prev) => prev.map((p) => (p.id === entryId ? { ...p, isInspecting: true, error: undefined } : p)));
    try {
      const meta = await inspectFileMetadata(target.file);
      setEntries((prev) => prev.map((p) => (p.id === entryId ? { ...p, inspected: meta, isInspecting: false } : p)));
    } catch (err: any) {
      setEntries((prev) =>
        prev.map((p) => (p.id === entryId ? { ...p, isInspecting: false, error: err?.message } : p))
      );
    }
  };

  const buildSingleEditOptions = (overrideScrubAll = false): MetadataEditOptions => {
    const parsedLastMod = editLastModStr ? new Date(editLastModStr).getTime() : undefined;
    const latNum = parseFloat(editLat);
    const lngNum = parseFloat(editLng);
    const altNum = editAlt.trim() !== '' ? parseFloat(editAlt) : undefined;

    return {
      newBaseName: editBaseName.trim() || activeEntry?.inspected?.baseName || 'file',
      newExtension: editExt.trim(),
      lastModifiedAction: overrideScrubAll ? 'reset' : lastModAction,
      newLastModified: parsedLastMod && !isNaN(parsedLastMod) ? parsedLastMod : undefined,
      embeddedDateAction: overrideScrubAll ? 'delete' : embeddedDateAction,
      newEmbeddedDate: editEmbeddedDateStr || undefined,
      gpsAction: overrideScrubAll ? 'delete' : gpsAction,
      newLatitude: !isNaN(latNum) ? latNum : undefined,
      newLongitude: !isNaN(lngNum) ? lngNum : undefined,
      newAltitude: altNum !== undefined && !isNaN(altNum) ? altNum : undefined,
      c2paAction: overrideScrubAll ? 'delete' : c2paAction,
      docMetaAction: overrideScrubAll ? 'delete' : docMetaAction,
      newDocMeta: {
        title: editTitle,
        author: editAuthor,
        subject: editSubject,
        keywords: editKeywords,
        software: editSoftware,
        copyright: editCopyright,
        description: editDescription,
        company: editCompany,
      },
      scrubAllMetadata: overrideScrubAll,
      preserveIccAndOrientation,
      deletedTagIds,
      editedTags: overrideScrubAll ? undefined : editedTagValues,
    };
  };

  const executeSingleApply = async (opts: MetadataEditOptions, downloadDirectly: boolean) => {
    if (!activeEntry?.inspected) return;
    setIsProcessingSingle(true);
    try {
      const res = await applyMetadataChanges(activeEntry.file, activeEntry.inspected, opts);
      // Update current entry so user immediately sees re-inspected clean result
      const reInspected = await inspectFileMetadata(res.file);
      setEntries((prev) =>
        prev.map((p) => (p.id === activeEntry.id ? { ...p, file: res.file, inspected: reInspected } : p))
      );

      const ext = (splitFileName(res.fileName).extension || activeEntry.inspected.detectedFormat || 'bin') as DocumentFormat;
      await saveProcessedFile(`meta_${Date.now()}`, activeEntry.file.name, res.fileName, res.blob, ext, {
        changes: res.changesApplied,
      });

      if (onResultReady) {
        onResultReady({
          id: `res_meta_${Date.now()}`,
          name: activeEntry.file.name,
          file: res.file,
          size: res.blob.size,
          type: res.blob.type,
          format: ext,
          targetFormat: ext,
          status: 'done',
          progress: 100,
          resultBlob: res.blob,
          resultName: res.fileName,
          previewUrl: res.blob.type.startsWith('image/') ? URL.createObjectURL(res.blob) : undefined,
        });
      }

      if (downloadDirectly) {
        const url = URL.createObjectURL(res.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }

      notifyCompletion(lang === 'ja' ? 'メタデータ処理完了' : 'Metadata Updated', res.fileName);
      if (onShowToast) {
        onShowToast(
          lang === 'ja'
            ? `${res.fileName} の変更を適用しました`
            : `Applied changes to ${res.fileName}`
        );
      }
    } catch (err: any) {
      console.error('Metadata apply error:', err);
      if (onShowToast) {
        onShowToast(err?.message || (lang === 'ja' ? 'メタデータ更新中にエラーが発生しました' : 'Failed to update metadata'));
      }
    } finally {
      setIsProcessingSingle(false);
    }
  };

  const handleExportReportJson = () => {
    if (!activeEntry?.inspected) return;
    const json = JSON.stringify(activeEntry.inspected, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeEntry.inspected.baseName}_metadata_report.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  // Batch Execution
  const executeBatch = async (downloadAsZip: boolean) => {
    const targetEntries = entries.filter((e) => batchSelectedIds.has(e.id) && e.inspected);
    if (targetEntries.length === 0) {
      if (onShowToast) {
        onShowToast(lang === 'ja' ? '処理対象のファイルを1つ以上選択してください' : 'Select at least one file');
      }
      return;
    }

    setIsProcessingBatch(true);
    setBatchProgress(0);
    const zip = downloadAsZip ? new JSZip() : null;
    const updatedMap = new Map<string, { file: File; inspected: InspectedMetadata }>();

    try {
      for (let i = 0; i < targetEntries.length; i++) {
        const entry = targetEntries[i];
        const meta = entry.inspected!;

        // 1. Compute new baseName
        let newBase = meta.baseName;
        if (batchRenameMode === 'affix') {
          if (batchFind) newBase = newBase.split(batchFind).join(batchReplace);
          newBase = `${batchPrefix}${newBase}${batchSuffix}`;
        } else if (batchRenameMode === 'sequential') {
          const pad = String(i + 1).padStart(3, '0');
          newBase = `${batchSeqBase || 'file_'}${pad}`;
        } else if (batchRenameMode === 'anonymize') {
          const rand = Math.random().toString(36).slice(2, 8);
          newBase = `doc_${String(i + 1).padStart(3, '0')}_${rand}`;
        }

        // 2. Compute new extension
        let newExt = meta.nameExtension;
        if (batchExtMode === 'set') {
          newExt = batchExtValue.trim().replace(/^\.+/, '');
        } else if (batchExtMode === 'lowercase') {
          newExt = meta.nameExtension.toLowerCase();
        } else if (batchExtMode === 'autofix') {
          newExt = meta.detectedFormat !== 'bin' ? meta.detectedFormat : meta.nameExtension;
        } else if (batchExtMode === 'remove') {
          newExt = '';
        }

        // 3. Compute lastModified
        let lModAction: 'keep' | 'set' | 'reset' = 'keep';
        let newLMod: number | undefined;
        if (batchLastModAction === 'set' && batchLastModStr) {
          lModAction = 'set';
          newLMod = new Date(batchLastModStr).getTime();
        } else if (batchLastModAction === 'shift') {
          const hrs = parseFloat(batchShiftHours) || 0;
          lModAction = 'set';
          newLMod = (entry.file.lastModified || Date.now()) + hrs * 3600 * 1000;
        } else if (batchLastModAction === 'reset') {
          lModAction = 'reset';
        }

        const latNum = parseFloat(batchLat);
        const lngNum = parseFloat(batchLng);

        const opts: MetadataEditOptions = {
          newBaseName: newBase,
          newExtension: newExt,
          lastModifiedAction: lModAction,
          newLastModified: newLMod,
          embeddedDateAction: batchEmbeddedDateAction,
          newEmbeddedDate: batchEmbeddedDateStr,
          gpsAction: batchGpsAction,
          newLatitude: !isNaN(latNum) ? latNum : undefined,
          newLongitude: !isNaN(lngNum) ? lngNum : undefined,
          c2paAction: batchDocMetaMode === 'scrub-all' ? 'delete' : batchC2paAction,
          docMetaAction: batchDocMetaMode === 'delete-personal' || batchDocMetaMode === 'scrub-all' ? 'delete' : 'keep',
          scrubAllMetadata: batchDocMetaMode === 'scrub-all',
          preserveIccAndOrientation: batchPreserveIcc,
        };

        const res = await applyMetadataChanges(entry.file, meta, opts);
        const reInspected = await inspectFileMetadata(res.file);
        updatedMap.set(entry.id, { file: res.file, inspected: reInspected });

        const ext = (splitFileName(res.fileName).extension || meta.detectedFormat || 'bin') as DocumentFormat;
        await saveProcessedFile(`meta_batch_${Date.now()}_${i}`, entry.file.name, res.fileName, res.blob, ext);

        if (onResultReady) {
          onResultReady({
            id: `res_meta_b_${Date.now()}_${i}`,
            name: entry.file.name,
            file: res.file,
            size: res.blob.size,
            type: res.blob.type,
            format: ext,
            targetFormat: ext,
            status: 'done',
            progress: 100,
            resultBlob: res.blob,
            resultName: res.fileName,
          });
        }

        if (zip) {
          zip.file(res.fileName, res.blob, { date: new Date(res.lastModified) });
        }

        setBatchProgress(Math.round(((i + 1) / targetEntries.length) * 100));
      }

      setEntries((prev) =>
        prev.map((p) => {
          const u = updatedMap.get(p.id);
          return u ? { ...p, file: u.file, inspected: u.inspected } : p;
        })
      );

      if (zip) {
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Metadata_Processed_${new Date().toISOString().slice(0, 10)}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }

      notifyCompletion(
        lang === 'ja' ? '一括メタデータ処理完了' : 'Batch Metadata Complete',
        `${targetEntries.length} ${lang === 'ja' ? '件処理しました' : 'files processed'}`
      );
      if (onShowToast) {
        onShowToast(
          lang === 'ja'
            ? `${targetEntries.length}件のファイルにメタデータ編集・削除を適用しました`
            : `Processed ${targetEntries.length} files`
        );
      }
    } catch (err: any) {
      console.error('Batch metadata error:', err);
      if (onShowToast) {
        onShowToast(err?.message || (lang === 'ja' ? '一括処理中にエラーが発生しました' : 'Batch error'));
      }
    } finally {
      setIsProcessingBatch(false);
    }
  };

  const availableTagGroups = useMemo(() => {
    if (!activeEntry?.inspected) return [];
    const seen = new Set<string>();
    for (const t of activeEntry.inspected.tags) {
      seen.add(t.group);
    }
    return ['ALL', ...Array.from(seen)];
  }, [activeEntry?.inspected]);

  const filteredTags = useMemo(() => {
    if (!activeEntry?.inspected) return [];
    const q = tagSearchQuery.trim().toLowerCase();
    return activeEntry.inspected.tags.filter((t) => {
      if (tagGroupFilter !== 'ALL' && t.group !== tagGroupFilter) return false;
      if (!q) return true;
      const guide = getMetadataFieldGuide(t, lang);
      return (
        t.key.toLowerCase().includes(q) ||
        t.value.toLowerCase().includes(q) ||
        (t.rawValue && t.rawValue.toLowerCase().includes(q)) ||
        t.group.toLowerCase().includes(q) ||
        guide.purpose.toLowerCase().includes(q) ||
        guide.risk.toLowerCase().includes(q)
      );
    });
  }, [activeEntry?.inspected, tagSearchQuery, tagGroupFilter, lang]);

  const meta = activeEntry?.inspected;

  const updateTagValue = (tagId: string, originalRaw: string, nextVal: string) => {
    setEditedTagValues((prev) => {
      const next = { ...prev };
      if (nextVal === originalRaw) {
        delete next[tagId];
      } else {
        next[tagId] = nextVal;
      }
      return next;
    });
    if (tagId === 'file_name') {
      setEditBaseName(nextVal);
    } else if (tagId === 'file_ext') {
      setEditExt(nextVal.replace(/^\.+/, ''));
    } else if (tagId === 'file_mtime') {
      if (nextVal === originalRaw) {
        setLastModAction('keep');
        setEditLastModStr(originalRaw);
      } else {
        setLastModAction('set');
        setEditLastModStr(nextVal);
      }
    }
  };

  const resetTagEdit = (tagId: string, originalRaw: string) => {
    setEditedTagValues((prev) => {
      const next = { ...prev };
      delete next[tagId];
      return next;
    });
    setDeletedTagIds((prev) => {
      if (!prev.has(tagId)) return prev;
      const next = new Set(prev);
      next.delete(tagId);
      return next;
    });
    if (tagId === 'file_name' && meta) {
      setEditBaseName(meta.baseName);
    } else if (tagId === 'file_ext' && meta) {
      setEditExt(meta.nameExtension);
    } else if (tagId === 'file_mtime') {
      setLastModAction('keep');
      setEditLastModStr(originalRaw);
    }
  };

  return (
    <div className="card flex flex-col gap-5">
      {/* Header & Mode Switch */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 break-keep">
            <FileSearch className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <span>
              {lang === 'ja'
                ? 'メタデータ・C2PA 確認・編集・削除'
                : 'Metadata & C2PA Inspector / Editor'}
            </span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {lang === 'ja'
              ? 'ファイル名・名前上の拡張子・日時・位置情報(GPS)・C2PA(Content Credentials)・EXIF/文書プロパティを単体または複数一括で確認・編集・削除します。'
              : 'Inspect, edit, and remove filenames, name extensions, timestamps, GPS coordinates, C2PA Content Credentials, and EXIF/Document properties.'}
          </p>
        </div>

        {/* Segmented Mode Control */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shrink-0">
          <button
            onClick={() => setMode('single')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'single'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            {lang === 'ja' ? '単体ファイル編集' : 'Single File'}
          </button>
          <button
            onClick={() => setMode('batch')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'batch'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            {lang === 'ja' ? `複数ファイル一括 (${entries.length})` : `Batch (${entries.length})`}
          </button>
        </div>
      </div>

      {/* File Upload Strip inside tab */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40">
        <div className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
          <Layers className="w-4 h-4 text-slate-400 shrink-0" />
          <span>
            {entries.length > 0
              ? lang === 'ja'
                ? `現在 ${entries.length} 件のファイルが検査対象として読み込まれています（全形式対応）`
                : `${entries.length} file(s) loaded for inspection (all formats supported)`
              : lang === 'ja'
              ? '上部の読み込みカード、または右のボタンからファイルをアップロードしてください'
              : 'Upload files via the top card or the button on the right'}
          </span>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              handleLocalFilesUploaded(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{lang === 'ja' ? 'ファイルを追加 (複数可)' : 'Add Files'}</span>
          </button>
        </div>
      </div>

      {/* Empty State */}
      {entries.length === 0 ? (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="py-12 px-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 text-center flex flex-col items-center gap-3 cursor-pointer hover:border-blue-400 transition"
        >
          <FileSearch className="w-10 h-10 text-slate-400" />
          <div>
            <p className="font-bold text-sm text-slate-700 dark:text-slate-200">
              {lang === 'ja'
                ? '確認・編集するファイルを選択またはドロップしてください'
                : 'Select or drop files to inspect and edit metadata'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {lang === 'ja'
                ? 'JPEG, PNG, WebP, PDF, Word/Excel/PowerPoint, MP4/MOV, HTML/SVG など全ファイル形式に対応'
                : 'Supports JPEG, PNG, WebP, PDF, Office, MP4/MOV, HTML/SVG, and any file format'}
            </p>
          </div>
        </div>
      ) : mode === 'single' ? (
        /* ==================== SINGLE FILE MODE ==================== */
        <div className="flex flex-col gap-4">
          {/* File Selector Row */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[220px]">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                {lang === 'ja' ? '検査・編集するファイル:' : 'Target File:'}
              </label>
              <select
                value={activeEntry?.id || ''}
                onChange={(e) => setSelectedSingleId(e.target.value)}
                className="select-field"
              >
                {entries.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.file.name} ({(e.file.size / 1024).toFixed(1)} KB)
                  </option>
                ))}
              </select>
            </div>
            {activeEntry && (
              <div className="pt-5 flex items-center gap-2">
                <button
                  onClick={() => handleReinspect(activeEntry.id)}
                  disabled={activeEntry.isInspecting}
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${activeEntry.isInspecting ? 'animate-spin' : ''}`} />
                  <span>{lang === 'ja' ? '再スキャン' : 'Re-scan'}</span>
                </button>
                <button
                  onClick={handleExportReportJson}
                  disabled={!meta}
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>{lang === 'ja' ? 'JSONレポート' : 'JSON Report'}</span>
                </button>
              </div>
            )}
          </div>

          {activeEntry?.isInspecting || !meta ? (
            <div className="py-10 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>{lang === 'ja' ? 'バイナリ・メタデータを解析中...' : 'Inspecting metadata...'}</span>
            </div>
          ) : (
            <>
              {/* Clean Unboxed Summary Strip */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50 flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="font-bold text-sm text-slate-900 dark:text-slate-100 break-all">
                    {meta.fileName}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums flex items-center gap-2 flex-wrap">
                    <span>{(meta.size / 1024).toFixed(1)} KB</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {lang === 'ja' ? '判定形式' : 'Detected'}: .{meta.detectedFormat}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{new Date(meta.lastModified).toLocaleString()}</span>
                  </div>
                </div>

                {/* Unboxed status summary with typographic separators */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs pt-1 border-t border-slate-200/80 dark:border-slate-800">
                  <span className={`font-semibold inline-flex items-center gap-1 ${meta.gps.found ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>
                    <MapPin className="w-3.5 h-3.5" />
                    {meta.gps.found
                      ? `${lang === 'ja' ? '位置情報あり' : 'GPS Found'} (${meta.gps.latitude?.toFixed(4)}, ${meta.gps.longitude?.toFixed(4)})`
                      : lang === 'ja'
                      ? '位置情報なし'
                      : 'No GPS'}
                  </span>
                  <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                  <span className={`font-semibold inline-flex items-center gap-1 ${meta.c2pa.found ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}`}>
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {meta.c2pa.found
                      ? `C2PA${lang === 'ja' ? '検出' : ' Found'}${meta.c2pa.generator ? ` (${meta.c2pa.generator})` : ''}`
                      : lang === 'ja'
                      ? 'C2PAなし'
                      : 'No C2PA'}
                  </span>
                  <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                  <span className="text-slate-600 dark:text-slate-300 tabular-nums">
                    {lang === 'ja' ? `抽出タグ: ${meta.tags.length}件` : `Tags: ${meta.tags.length}`}
                  </span>
                </div>

                {meta.extensionMismatch && (
                  <div className="mt-1 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-800 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>
                        {lang === 'ja'
                          ? `名前上の拡張子 (.${meta.nameExtension}) と実データ形式 (.${meta.detectedFormat}) が異なります。`
                          : `Name extension (.${meta.nameExtension}) differs from detected signature (.${meta.detectedFormat}).`}
                      </span>
                    </span>
                    <button
                      onClick={() => setEditExt(meta.detectedFormat)}
                      className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-semibold text-[11px] cursor-pointer whitespace-nowrap"
                    >
                      {lang === 'ja' ? `.${meta.detectedFormat} に修正` : `Fix to .${meta.detectedFormat}`}
                    </button>
                  </div>
                )}
              </div>

              {/* Section Sub-Tabs */}
              <div className="flex flex-wrap gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-2">
                {[
                  { id: 'basic', labelJa: 'ファイル名・拡張子・日時', labelEn: 'Name, Ext & Dates', icon: Calendar },
                  { id: 'gps', labelJa: `位置情報 GPS${meta.gps.found ? ' *' : ''}`, labelEn: `GPS${meta.gps.found ? ' *' : ''}`, icon: MapPin },
                  { id: 'c2pa', labelJa: `C2PA・来歴${meta.c2pa.found ? ' *' : ''}`, labelEn: `C2PA${meta.c2pa.found ? ' *' : ''}`, icon: ShieldCheck },
                  {
                    id: 'tags',
                    labelJa: `全メタデータ編集・リスク (${meta.tags.length})`,
                    labelEn: `Edit All Metadata (${meta.tags.length})`,
                    icon: Tag,
                  },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const active = singleSection === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setSingleSection(tab.id as any)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                        active
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{lang === 'ja' ? tab.labelJa : tab.labelEn}</span>
                    </button>
                  );
                })}
              </div>

              {/* Section 1: Filename, Extension & Timestamps */}
              {singleSection === 'basic' && (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1 block">
                        {lang === 'ja' ? 'ファイル名（拡張子を除く）' : 'File Base Name'}
                      </label>
                      <input
                        type="text"
                        value={editBaseName}
                        onChange={(e) => {
                          const v = e.target.value;
                          setEditBaseName(v);
                          setEditedTagValues((prev) => {
                            if (!Object.prototype.hasOwnProperty.call(prev, 'file_name')) return prev;
                            const next = { ...prev };
                            delete next['file_name'];
                            return next;
                          });
                        }}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1 block">
                        {lang === 'ja' ? '名前上の拡張子' : 'Name Extension'}
                      </label>
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-400 font-mono text-sm">.</span>
                        <input
                          type="text"
                          value={editExt}
                          onChange={(e) => {
                            const v = e.target.value.replace(/^\.+/, '');
                            setEditExt(v);
                            setEditedTagValues((prev) => {
                              if (!Object.prototype.hasOwnProperty.call(prev, 'file_ext')) return prev;
                              const next = { ...prev };
                              delete next['file_ext'];
                              return next;
                            });
                          }}
                          placeholder={meta.detectedFormat}
                          className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Quick Name/Ext Actions */}
                  <div className="flex flex-wrap gap-2 text-xs">
                    <button
                      onClick={() => {
                        setEditExt(meta.detectedFormat);
                        setEditedTagValues((prev) => {
                          if (!Object.prototype.hasOwnProperty.call(prev, 'file_ext')) return prev;
                          const next = { ...prev };
                          delete next['file_ext'];
                          return next;
                        });
                      }}
                      className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      {lang === 'ja' ? `実形式 (.${meta.detectedFormat}) に合わせる` : `Match detected (.${meta.detectedFormat})`}
                    </button>
                    <button
                      onClick={() => {
                        setEditExt(editExt.toLowerCase());
                        setEditedTagValues((prev) => {
                          if (!Object.prototype.hasOwnProperty.call(prev, 'file_ext')) return prev;
                          const next = { ...prev };
                          delete next['file_ext'];
                          return next;
                        });
                      }}
                      className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      {lang === 'ja' ? '拡張子を小文字にする' : 'Lowercase Ext'}
                    </button>
                    <button
                      onClick={() => {
                        setEditExt('');
                        setEditedTagValues((prev) => {
                          if (!Object.prototype.hasOwnProperty.call(prev, 'file_ext')) return prev;
                          const next = { ...prev };
                          delete next['file_ext'];
                          return next;
                        });
                      }}
                      className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                    >
                      {lang === 'ja' ? '名前上の拡張子を削除' : 'Remove Name Ext'}
                    </button>
                    <button
                      onClick={() => {
                        setEditBaseName(`anon_${Math.random().toString(36).slice(2, 10)}`);
                        setEditedTagValues((prev) => {
                          if (!Object.prototype.hasOwnProperty.call(prev, 'file_name')) return prev;
                          const next = { ...prev };
                          delete next['file_name'];
                          return next;
                        });
                      }}
                      className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      {lang === 'ja' ? 'ファイル名をランダム匿名化' : 'Anonymize Name'}
                    </button>
                  </div>

                  <div className="border-t border-slate-200 dark:border-slate-800 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* File System LastModified */}
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-0">
                        {lang === 'ja' ? 'ファイル更新日時 (File Timestamp)' : 'File Last Modified'}
                      </label>
                      <select
                        value={lastModAction}
                        onChange={(e) => {
                          setLastModAction(e.target.value as any);
                          setEditedTagValues((prev) => {
                            if (!Object.prototype.hasOwnProperty.call(prev, 'file_mtime')) return prev;
                            const next = { ...prev };
                            delete next['file_mtime'];
                            return next;
                          });
                        }}
                        className="select-field text-xs"
                      >
                        <option value="keep">{lang === 'ja' ? 'そのまま維持' : 'Keep Original'}</option>
                        <option value="set">{lang === 'ja' ? '指定日時に変更' : 'Set Custom Date & Time'}</option>
                        <option value="reset">{lang === 'ja' ? 'リセット (2000-01-01 00:00)' : 'Reset to 2000-01-01'}</option>
                      </select>
                      {lastModAction === 'set' && (
                        <input
                          type="datetime-local"
                          value={editLastModStr}
                          onChange={(e) => {
                            setEditLastModStr(e.target.value);
                            setEditedTagValues((prev) => {
                              if (!Object.prototype.hasOwnProperty.call(prev, 'file_mtime')) return prev;
                              const next = { ...prev };
                              delete next['file_mtime'];
                              return next;
                            });
                          }}
                          className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                        />
                      )}
                      <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                        {lang === 'ja' ? '現在値: ' : 'Current: '}
                        {new Date(meta.lastModified).toLocaleString()}
                      </p>
                    </div>

                    {/* Embedded Dates */}
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-0">
                        {lang === 'ja' ? '埋め込み撮影・作成日時 (EXIF / PDF / Office)' : 'Embedded Creation / Modify Dates'}
                      </label>
                      <select
                        value={embeddedDateAction}
                        onChange={(e) => setEmbeddedDateAction(e.target.value as any)}
                        disabled={!meta.capabilities.canEditEmbeddedDates}
                        className="select-field text-xs disabled:opacity-50"
                      >
                        <option value="keep">{lang === 'ja' ? 'そのまま維持' : 'Keep Original'}</option>
                        <option value="set">{lang === 'ja' ? '指定日時に編集・統一' : 'Set Custom Date & Time'}</option>
                        <option value="delete">{lang === 'ja' ? '埋め込み日時を削除' : 'Delete Embedded Dates'}</option>
                      </select>
                      {embeddedDateAction === 'set' && (
                        <input
                          type="datetime-local"
                          value={editEmbeddedDateStr}
                          onChange={(e) => setEditEmbeddedDateStr(e.target.value)}
                          className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                        />
                      )}
                      <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                        {meta.embeddedDates.original || meta.embeddedDates.created || meta.embeddedDates.modified
                          ? `${meta.embeddedDates.original || meta.embeddedDates.created || meta.embeddedDates.modified}`
                          : lang === 'ja'
                          ? '埋め込み日時: 検出なし'
                          : 'No embedded dates found'}
                      </p>
                    </div>
                  </div>

                  {/* Purpose & Risk Summary for Basic Section */}
                  <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 text-[11px] text-slate-600 dark:text-slate-300 flex flex-col gap-1 break-keep">
                    <div>
                      <span className="font-semibold text-slate-800 dark:text-slate-100">
                        {lang === 'ja' ? '設定内容: ' : 'Purpose: '}
                      </span>
                      {lang === 'ja'
                        ? 'OSのファイル識別名・拡張子ラベル、およびファイルシステム上/コンテナ内部のタイムスタンプを設定します。'
                        : 'Configures the OS filename/extension label and filesystem or container-embedded timestamps.'}
                    </div>
                    <div>
                      <span className="font-semibold text-amber-700 dark:text-amber-300">
                        {lang === 'ja' ? '変更リスク: ' : 'Modification Risk: '}
                      </span>
                      {lang === 'ja'
                        ? '実形式と異なる拡張子へ変更するとアプリで開けなくなるリスクがあります。また日時やファイル名の改変は、証跡監査・バージョン管理・外部参照リンクに影響します（DL時はブラウザ仕様によりファイル更新日時が現在時刻へ丸められる場合があります）。'
                        : 'Changing the extension away from the binary format can prevent opening. Timestamp or name changes affect audit trails, sorting, and external links.'}
                    </div>
                  </div>
                </div>
              )}

              {/* Section 2: GPS / Location */}
              {singleSection === 'gps' && (
                <div className="flex flex-col gap-4">
                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                        {meta.gps.found
                          ? lang === 'ja'
                            ? '位置情報（GPS座標）が埋め込まれています'
                            : 'GPS Location Metadata Detected'
                          : lang === 'ja'
                          ? 'このファイルに位置情報（GPS）は検出されませんでした'
                          : 'No GPS Location Metadata Found'}
                      </span>
                      {meta.gps.found && (
                        <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300 flex flex-wrap gap-3">
                          <span>
                            {lang === 'ja' ? '緯度' : 'Lat'}: {meta.gps.latitude?.toFixed(6) ?? '-'}
                          </span>
                          <span>
                            {lang === 'ja' ? '経度' : 'Lng'}: {meta.gps.longitude?.toFixed(6) ?? '-'}
                          </span>
                          {meta.gps.altitude !== undefined && (
                            <span>
                              {lang === 'ja' ? '標高' : 'Alt'}: {meta.gps.altitude.toFixed(1)} m
                            </span>
                          )}
                          {meta.gps.source && <span>({meta.gps.source})</span>}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {meta.gps.found && meta.gps.latitude !== undefined && meta.gps.longitude !== undefined && (
                        <a
                          href={`https://www.google.com/maps?q=${meta.gps.latitude},${meta.gps.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-blue-600 dark:text-blue-400 inline-flex items-center gap-1 hover:underline"
                        >
                          <span>{lang === 'ja' ? '地図で確認' : 'Open Map'}</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                      {meta.gps.found && (
                        <button
                          onClick={() => {
                            const opts = buildSingleEditOptions(false);
                            opts.gpsAction = 'delete';
                            executeSingleApply(opts, false);
                          }}
                          disabled={isProcessingSingle}
                          className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>{lang === 'ja' ? '位置情報のみ即時削除' : 'Remove GPS Only'}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* GPS Edit Options */}
                  <div className="flex flex-col gap-3">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-0">
                      {lang === 'ja' ? '位置情報の処理設定' : 'GPS Modification Action'}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { id: 'keep', labelJa: '変更しない', labelEn: 'Keep Original' },
                        { id: 'delete', labelJa: '位置情報を削除する', labelEn: 'Delete GPS' },
                        { id: 'set', labelJa: '座標を編集・新規設定', labelEn: 'Edit / Set Coordinates', disabled: !meta.capabilities.canEditGps },
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          disabled={opt.disabled}
                          onClick={() => setGpsAction(opt.id as any)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer disabled:opacity-40 ${
                            gpsAction === opt.id
                              ? 'bg-blue-600 border-blue-600 text-white'
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {lang === 'ja' ? opt.labelJa : opt.labelEn}
                        </button>
                      ))}
                    </div>

                    {gpsAction === 'set' && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
                        <div>
                          <label className="text-[11px] font-semibold text-slate-500 mb-1 block">
                            {lang === 'ja' ? '緯度 (Latitude, 例: 35.681236)' : 'Latitude (-90 to 90)'}
                          </label>
                          <input
                            type="number"
                            step="0.000001"
                            value={editLat}
                            onChange={(e) => setEditLat(e.target.value)}
                            placeholder="35.681236"
                            className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-slate-500 mb-1 block">
                            {lang === 'ja' ? '経度 (Longitude, 例: 139.767125)' : 'Longitude (-180 to 180)'}
                          </label>
                          <input
                            type="number"
                            step="0.000001"
                            value={editLng}
                            onChange={(e) => setEditLng(e.target.value)}
                            placeholder="139.767125"
                            className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-slate-500 mb-1 block">
                            {lang === 'ja' ? '標高 m (任意)' : 'Altitude m (Optional)'}
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            value={editAlt}
                            onChange={(e) => setEditAlt(e.target.value)}
                            placeholder="0"
                            className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                          />
                        </div>
                      </div>
                    )}

                    {/* Purpose & Risk Summary for GPS Section */}
                    <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 text-[11px] text-slate-600 dark:text-slate-300 flex flex-col gap-1 break-keep">
                      <div>
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          {lang === 'ja' ? '設定内容: ' : 'Purpose: '}
                        </span>
                        {lang === 'ja'
                          ? '撮影場所や記録地点を示すEXIF GPS座標（緯度・経度・標高・UTC測位時刻）およびXMP/動画座標を設定します。'
                          : 'Configures embedded EXIF/XMP/container GPS coordinates (latitude, longitude, altitude, UTC timestamp).'}
                      </div>
                      <div>
                        <span className="font-semibold text-rose-700 dark:text-rose-300">
                          {lang === 'ja' ? '変更リスク: ' : 'Modification Risk: '}
                        </span>
                        {lang === 'ja'
                          ? '座標が残ったまま共有すると自宅や移動先が特定されるプライバシーリスクがあります。一方で変更・削除すると地図アルバム連携・撮影場所証明・位置ベース検索が機能しなくなります。'
                          : 'Leaving GPS intact leaks physical location upon sharing, while removing or altering it breaks map albums and location verification.'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Section 3: C2PA / Content Credentials */}
              {singleSection === 'c2pa' && (
                <div className="flex flex-col gap-4">
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {meta.c2pa.found ? (
                          <ShieldAlert className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
                        ) : (
                          <ShieldCheck className="w-5 h-5 text-slate-400 shrink-0" />
                        )}
                        <div>
                          <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
                            {meta.c2pa.found
                              ? lang === 'ja'
                                ? 'C2PA (Content Credentials / JUMBF) を検出しました'
                                : 'C2PA Content Credentials Detected'
                              : lang === 'ja'
                              ? 'C2PA / Content Credentials は含まれていません'
                              : 'No C2PA Content Credentials Found'}
                          </div>
                          {meta.c2pa.found && (
                            <div className="text-xs text-slate-500 font-mono tabular-nums">
                              {meta.c2pa.locations.join(', ')} · {(meta.c2pa.totalBytes / 1024).toFixed(2)} KB
                            </div>
                          )}
                        </div>
                      </div>

                      {meta.c2pa.found && meta.capabilities.canStripC2pa && (
                        <button
                          onClick={() => {
                            const opts = buildSingleEditOptions(false);
                            opts.c2paAction = 'delete';
                            executeSingleApply(opts, false);
                          }}
                          disabled={isProcessingSingle}
                          className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>{lang === 'ja' ? 'C2PA情報を削除する' : 'Strip C2PA Credentials'}</span>
                        </button>
                      )}
                    </div>

                    {meta.c2pa.found && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
                        <div>
                          <span className="text-[11px] text-slate-500 block">
                            {lang === 'ja' ? '生成アプリ / ツール (Claim Generator)' : 'Claim Generator'}
                          </span>
                          <span className="font-semibold text-slate-800 dark:text-slate-100">
                            {meta.c2pa.generator || (lang === 'ja' ? '不明 / バイナリ格納' : 'Unknown')}
                          </span>
                        </div>
                        <div>
                          <span className="text-[11px] text-slate-500 block">
                            {lang === 'ja' ? 'デジタルソース種別 (DigitalSourceType)' : 'Digital Source Type'}
                          </span>
                          <span className="font-mono text-slate-800 dark:text-slate-100">
                            {meta.c2pa.digitalSourceType || '-'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[11px] text-slate-500 block">
                            {lang === 'ja' ? '署名・発行者 (Signer / Certificate)' : 'Signer / Issuer'}
                          </span>
                          <span className="font-mono text-slate-800 dark:text-slate-100 break-all">
                            {meta.c2pa.signer || '-'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[11px] text-slate-500 block">
                            {lang === 'ja' ? '記録アクション (Actions)' : 'Recorded Actions'}
                          </span>
                          <span className="font-mono text-slate-800 dark:text-slate-100">
                            {meta.c2pa.actions.length > 0 ? meta.c2pa.actions.join(', ') : '-'}
                          </span>
                        </div>
                        {meta.c2pa.manifestUrn && (
                          <div className="sm:col-span-2">
                            <span className="text-[11px] text-slate-500 block">Manifest URN</span>
                            <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300 break-all">
                              {meta.c2pa.manifestUrn}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {meta.c2pa.boxes.length > 0 && (
                      <div className="pt-1">
                        <button
                          onClick={() => setShowC2paRaw(!showC2paRaw)}
                          className="text-xs font-semibold text-blue-600 dark:text-blue-400 inline-flex items-center gap-1 cursor-pointer"
                        >
                          {showC2paRaw ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          <span>
                            {lang === 'ja'
                              ? `JUMBFボックス構造を表示 (${meta.c2pa.boxes.length}個)`
                              : `Inspect JUMBF Boxes (${meta.c2pa.boxes.length})`}
                          </span>
                        </button>
                        {showC2paRaw && (
                          <div className="mt-2 max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-950 p-2.5 text-[11px] font-mono flex flex-col gap-2">
                            {meta.c2pa.boxes.map((box, idx) => (
                              <div key={idx} className="border-b border-slate-100 dark:border-slate-900 pb-1.5 last:border-none">
                                <div className="font-bold text-slate-800 dark:text-slate-200">
                                  [{idx + 1}] {box.label} ({box.size} bytes)
                                </div>
                                {box.uuid && <div className="text-slate-400">UUID: {box.uuid}</div>}
                                {box.details.length > 0 && (
                                  <div className="text-slate-600 dark:text-slate-400 break-all mt-0.5">
                                    {box.details.join(' · ')}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* C2PA Action & Technical Notice */}
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-0">
                      {lang === 'ja' ? 'C2PAの処理設定' : 'C2PA Action'}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setC2paAction('keep')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                          c2paAction === 'keep'
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {lang === 'ja' ? 'C2PAを維持する' : 'Keep C2PA'}
                      </button>
                      <button
                        onClick={() => setC2paAction('delete')}
                        disabled={!meta.capabilities.canStripC2pa}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer disabled:opacity-40 ${
                          c2paAction === 'delete'
                            ? 'bg-rose-600 border-rose-600 text-white'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {lang === 'ja' ? 'C2PA・AI来歴タグを削除する' : 'Delete C2PA & AI Provenance'}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {lang === 'ja'
                        ? '※ C2PAマニフェストは暗号署名で保護されているため、任意の値への書き換えは仕様上無効な署名となります。プライバシー保護や再配布用途では「削除」を選択してください（JPEG APP11 / PNG caBX / WebP C2PA / MP4 uuid / XMP DigitalSourceType の除去に対応）。'
                        : 'C2PA manifests are cryptographically signed; strip them cleanly when privacy or redistribution requires removing provenance data.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Section 4: Document/EXIF Properties & Inline Editor for ALL Detected Tags */}
              {singleSection === 'tags' && (
                <div className="flex flex-col gap-4">
                  {/* Bulk Document / EXIF Summary Overrides */}
                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                        {lang === 'ja' ? '基本プロパティ一括編集（作成者・タイトル・ソフトウェア）' : 'Bulk Author, Title & Software Properties'}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { id: 'keep', labelJa: '維持', labelEn: 'Keep' },
                          { id: 'set', labelJa: '一括編集', labelEn: 'Bulk Edit', disabled: !meta.capabilities.canEditDocMeta },
                          { id: 'delete', labelJa: '一括削除', labelEn: 'Clear All', disabled: !meta.capabilities.canEditDocMeta },
                        ].map((opt) => (
                          <button
                            key={opt.id}
                            disabled={opt.disabled}
                            onClick={() => setDocMetaAction(opt.id as any)}
                            className={`px-2.5 py-1 rounded text-xs font-semibold border cursor-pointer disabled:opacity-40 ${
                              docMetaAction === opt.id
                                ? 'bg-blue-600 border-blue-600 text-white'
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {lang === 'ja' ? opt.labelJa : opt.labelEn}
                          </button>
                        ))}
                      </div>
                    </div>

                    {docMetaAction === 'set' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                        <div>
                          <label className="text-[11px] text-slate-500 mb-1 block">{lang === 'ja' ? 'タイトル (Title)' : 'Title'}</label>
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-slate-500 mb-1 block">{lang === 'ja' ? '作成者 / 撮影者 (Author / Artist)' : 'Author / Artist'}</label>
                          <input
                            type="text"
                            value={editAuthor}
                            onChange={(e) => setEditAuthor(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-slate-500 mb-1 block">{lang === 'ja' ? 'ソフトウェア / 作成アプリ (Software / Creator)' : 'Software / Creator'}</label>
                          <input
                            type="text"
                            value={editSoftware}
                            onChange={(e) => setEditSoftware(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-slate-500 mb-1 block">{lang === 'ja' ? '著作権 (Copyright)' : 'Copyright'}</label>
                          <input
                            type="text"
                            value={editCopyright}
                            onChange={(e) => setEditCopyright(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-slate-500 mb-1 block">{lang === 'ja' ? '説明 / コメント (Description)' : 'Description'}</label>
                          <input
                            type="text"
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-slate-500 mb-1 block">{lang === 'ja' ? 'キーワード / 会社名 (Keywords / Company)' : 'Keywords / Company'}</label>
                          <input
                            type="text"
                            value={editKeywords || editCompany}
                            onChange={(e) => {
                              setEditKeywords(e.target.value);
                              setEditCompany(e.target.value);
                            }}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Extracted Tags Interactive Editor with Purpose & Risk */}
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-100 block">
                          {lang === 'ja'
                            ? '検出された全メタデータ（直接編集・設定内容・変更リスク）'
                            : 'All Detected Metadata Tags (Inline Edit, Purpose & Modification Risk)'}
                        </span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                          {lang === 'ja'
                            ? `表示 ${filteredTags.length} / 全 ${meta.tags.length} 件 · 編集中 ${Object.keys(editedTagValues).length} 件 · 削除予定 ${deletedTagIds.size} 件`
                            : `Showing ${filteredTags.length} of ${meta.tags.length} · Edited ${Object.keys(editedTagValues).length} · Deleting ${deletedTagIds.size}`}
                        </span>
                      </div>
                      <div className="relative w-full sm:w-64">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={tagSearchQuery}
                          onChange={(e) => setTagSearchQuery(e.target.value)}
                          placeholder={lang === 'ja' ? 'タグ名・値・内容・リスクで検索...' : 'Filter tags, values, or risks...'}
                          className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                        />
                      </div>
                    </div>

                    {/* Group Filter Buttons */}
                    {availableTagGroups.length > 2 && (
                      <div className="flex flex-wrap gap-1.5">
                        {availableTagGroups.map((grp) => {
                          const active = tagGroupFilter === grp;
                          const label = grp === 'ALL' ? (lang === 'ja' ? 'すべて' : 'All') : grp;
                          return (
                            <button
                              key={grp}
                              onClick={() => setTagGroupFilter(grp)}
                              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition cursor-pointer ${
                                active
                                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Per-Tag Editor Cards */}
                    <div className="max-h-[34rem] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-950/60">
                      {filteredTags.length === 0 ? (
                        <div className="p-6 text-center text-xs text-slate-400">
                          {lang === 'ja' ? '該当するメタデータはありません' : 'No matching metadata tags'}
                        </div>
                      ) : (
                        filteredTags.map((tag) => {
                          const guide = getMetadataFieldGuide(tag, lang);
                          const originalRaw = tag.rawValue ?? tag.value;
                          const isEdited = Object.prototype.hasOwnProperty.call(editedTagValues, tag.id);
                          const currentVal = isEdited ? editedTagValues[tag.id] : originalRaw;
                          const isMarkedDelete = deletedTagIds.has(tag.id);
                          const canEdit = tag.editable !== false && guide.inputKind !== 'readonly-physical';

                          const riskTextClass =
                            guide.riskLevel === 'high'
                              ? 'text-rose-600 dark:text-rose-400'
                              : guide.riskLevel === 'medium'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-slate-500 dark:text-slate-400';

                          const riskLabel =
                            guide.riskLevel === 'high'
                              ? lang === 'ja'
                                ? '高リスク'
                                : 'High Risk'
                              : guide.riskLevel === 'medium'
                              ? lang === 'ja'
                                ? '中リスク'
                                : 'Medium Risk'
                              : lang === 'ja'
                              ? '低リスク'
                              : 'Low Risk';

                          return (
                            <div
                              key={tag.id}
                              className={`p-3.5 flex flex-col gap-2.5 text-xs transition ${
                                isMarkedDelete
                                  ? 'bg-rose-50/60 dark:bg-rose-950/20'
                                  : isEdited
                                  ? 'bg-blue-50/40 dark:bg-blue-950/15'
                                  : 'hover:bg-slate-50/70 dark:hover:bg-slate-900/30'
                              }`}
                            >
                              {/* Tag Header Row */}
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                  <span className="text-[11px] font-mono font-semibold text-slate-400 dark:text-slate-500">
                                    {tag.group}
                                  </span>
                                  <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                                  <span
                                    className={`font-bold text-slate-800 dark:text-slate-100 break-all ${
                                      isMarkedDelete ? 'line-through opacity-60' : ''
                                    }`}
                                  >
                                    {tag.key}
                                  </span>
                                  <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                                  <span className={`text-[11px] font-semibold ${riskTextClass}`}>{riskLabel}</span>
                                  {isEdited && !isMarkedDelete && (
                                    <>
                                      <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                                      <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                                        {lang === 'ja' ? '編集済み' : 'Edited'}
                                      </span>
                                    </>
                                  )}
                                  {isMarkedDelete && (
                                    <>
                                      <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                                      <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                                        {lang === 'ja' ? '削除予定' : 'Marked for Deletion'}
                                      </span>
                                    </>
                                  )}
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  {(isEdited || isMarkedDelete) && (
                                    <button
                                      onClick={() => resetTagEdit(tag.id, originalRaw)}
                                      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                                    >
                                      {lang === 'ja' ? '元に戻す' : 'Reset'}
                                    </button>
                                  )}
                                  {tag.deletable && (
                                    <button
                                      onClick={() => {
                                        setDeletedTagIds((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(tag.id)) next.delete(tag.id);
                                          else next.add(tag.id);
                                          return next;
                                        });
                                      }}
                                      title={lang === 'ja' ? '削除対象に切替' : 'Toggle delete'}
                                      className={`px-2 py-1 rounded border text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                                        isMarkedDelete
                                          ? 'border-rose-300 dark:border-rose-800 bg-rose-600 text-white'
                                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400'
                                      }`}
                                    >
                                      <Trash2 className="w-3 h-3" />
                                      <span>{isMarkedDelete ? (lang === 'ja' ? '削除取消' : 'Undo Del') : (lang === 'ja' ? '削除' : 'Delete')}</span>
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Inline Value Editor */}
                              {!canEdit ? (
                                <div className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-900/60 font-mono text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center justify-between gap-2">
                                  <span className="break-all">{tag.value}</span>
                                  <span className="text-[10px] font-sans text-slate-400">
                                    {lang === 'ja' ? '実データ連動値（個別編集不可）' : 'Physical value (read-only)'}
                                  </span>
                                </div>
                              ) : guide.inputKind === 'orientation' ? (
                                <div className="flex flex-col sm:flex-row gap-2">
                                  <select
                                    disabled={isMarkedDelete}
                                    value={['1', '2', '3', '4', '5', '6', '7', '8'].includes(String(currentVal).trim()) ? String(currentVal).trim() : 'custom'}
                                    onChange={(e) => {
                                      if (e.target.value !== 'custom') {
                                        updateTagValue(tag.id, originalRaw, e.target.value);
                                      }
                                    }}
                                    className="select-field text-xs font-mono disabled:opacity-50"
                                  >
                                    <option value="1">1 — {lang === 'ja' ? '通常（回転なし）' : 'Normal (0°)'}</option>
                                    <option value="2">2 — {lang === 'ja' ? '左右反転' : 'Flip Horizontal'}</option>
                                    <option value="3">3 — {lang === 'ja' ? '180° 回転' : 'Rotate 180°'}</option>
                                    <option value="4">4 — {lang === 'ja' ? '上下反転' : 'Flip Vertical'}</option>
                                    <option value="5">5 — {lang === 'ja' ? '左右反転 + 左90°' : 'Transpose'}</option>
                                    <option value="6">6 — {lang === 'ja' ? '右90° 回転' : 'Rotate 90° CW'}</option>
                                    <option value="7">7 — {lang === 'ja' ? '左右反転 + 右90°' : 'Transverse'}</option>
                                    <option value="8">8 — {lang === 'ja' ? '左90° 回転' : 'Rotate 90° CCW'}</option>
                                    {!['1', '2', '3', '4', '5', '6', '7', '8'].includes(String(currentVal).trim()) && (
                                      <option value="custom">{currentVal}</option>
                                    )}
                                  </select>
                                </div>
                              ) : guide.inputKind === 'datetime' && tag.id === 'file_mtime' ? (
                                <input
                                  type="datetime-local"
                                  disabled={isMarkedDelete}
                                  value={currentVal}
                                  onChange={(e) => updateTagValue(tag.id, originalRaw, e.target.value)}
                                  className="w-full sm:w-72 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 disabled:opacity-50"
                                />
                              ) : guide.inputKind === 'multiline' ? (
                                <textarea
                                  rows={2}
                                  disabled={isMarkedDelete}
                                  value={currentVal}
                                  onChange={(e) => updateTagValue(tag.id, originalRaw, e.target.value)}
                                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500 disabled:opacity-50"
                                />
                              ) : (
                                <input
                                  type="text"
                                  disabled={isMarkedDelete}
                                  value={currentVal}
                                  onChange={(e) => updateTagValue(tag.id, originalRaw, e.target.value)}
                                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500 disabled:opacity-50"
                                />
                              )}

                              {/* Directly Visible Purpose & Risk Guide */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 text-[11px] leading-relaxed break-keep">
                                <div className="text-slate-600 dark:text-slate-300">
                                  <span className="font-semibold text-slate-800 dark:text-slate-100">
                                    {lang === 'ja' ? '設定内容: ' : 'Sets: '}
                                  </span>
                                  <span>{guide.purpose}</span>
                                </div>
                                <div className="text-slate-600 dark:text-slate-300">
                                  <span className={`font-semibold ${riskTextClass}`}>
                                    {lang === 'ja' ? '変更リスク: ' : 'Risk: '}
                                  </span>
                                  <span>{guide.risk}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Bottom Single Execution Bar */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-col gap-3">
                <label className="checkbox-row m-0">
                  <input
                    type="checkbox"
                    checked={preserveIccAndOrientation}
                    onChange={(e) => setPreserveIccAndOrientation(e.target.checked)}
                    className="checkbox-field"
                  />
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {lang === 'ja'
                      ? '画像のカラープロファイル(ICC)と向き(Orientation)は維持する（推奨）'
                      : 'Preserve ICC Color Profile & Image Orientation (Recommended)'}
                  </span>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    onClick={() => executeSingleApply(buildSingleEditOptions(false), false)}
                    disabled={isProcessingSingle}
                    className="btn btn-primary py-2.5 text-xs sm:text-sm"
                  >
                    <Check className="w-4 h-4" />
                    <span>{lang === 'ja' ? '変更を適用してキューに追加' : 'Apply & Add to Queue'}</span>
                  </button>

                  <button
                    onClick={() => executeSingleApply(buildSingleEditOptions(false), true)}
                    disabled={isProcessingSingle}
                    className="btn py-2.5 text-xs sm:text-sm"
                  >
                    <Download className="w-4 h-4" />
                    <span>{lang === 'ja' ? '変更を適用して直接保存' : 'Apply & Download'}</span>
                  </button>

                  <button
                    onClick={() => executeSingleApply(buildSingleEditOptions(true), true)}
                    disabled={isProcessingSingle || !meta.capabilities.canStripAllMeta}
                    className="px-4 py-2.5 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/60 font-semibold text-xs sm:text-sm inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
                  >
                    <Eraser className="w-4 h-4" />
                    <span>{lang === 'ja' ? '全メタデータ完全削除' : 'Scrub All Metadata'}</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        /* ==================== BATCH MULTI-FILE MODE ==================== */
        <div className="flex flex-col gap-4">
          {/* Quick Filter / Selection Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setBatchSelectedIds(new Set(entries.map((e) => e.id)))}
                className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold text-slate-700 dark:text-slate-300 cursor-pointer hover:bg-slate-50"
              >
                {lang === 'ja' ? 'すべて選択' : 'Select All'}
              </button>
              <button
                onClick={() => setBatchSelectedIds(new Set())}
                className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold text-slate-700 dark:text-slate-300 cursor-pointer hover:bg-slate-50"
              >
                {lang === 'ja' ? '選択解除' : 'Clear'}
              </button>
              <button
                onClick={() => setBatchSelectedIds(new Set(entries.filter((e) => e.inspected?.gps.found).map((e) => e.id)))}
                className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold text-amber-700 dark:text-amber-300 cursor-pointer hover:bg-amber-50"
              >
                {lang === 'ja' ? 'GPSありのみ選択' : 'Select with GPS'}
              </button>
              <button
                onClick={() => setBatchSelectedIds(new Set(entries.filter((e) => e.inspected?.c2pa.found).map((e) => e.id)))}
                className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold text-blue-700 dark:text-blue-300 cursor-pointer hover:bg-blue-50"
              >
                {lang === 'ja' ? 'C2PAありのみ選択' : 'Select with C2PA'}
              </button>
            </div>
            <span className="font-mono tabular-nums text-slate-500 font-semibold">
              {batchSelectedIds.size} / {entries.length} {lang === 'ja' ? '件選択中' : 'selected'}
            </span>
          </div>

          {/* Multi-file Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="p-2.5 w-8"></th>
                  <th className="p-2.5 font-semibold">{lang === 'ja' ? 'ファイル名・拡張子' : 'File & Ext'}</th>
                  <th className="p-2.5 font-semibold text-right whitespace-nowrap">{lang === 'ja' ? 'サイズ' : 'Size'}</th>
                  <th className="p-2.5 font-semibold whitespace-nowrap">{lang === 'ja' ? '日時' : 'Timestamp'}</th>
                  <th className="p-2.5 font-semibold whitespace-nowrap">{lang === 'ja' ? '位置情報' : 'GPS'}</th>
                  <th className="p-2.5 font-semibold whitespace-nowrap">C2PA</th>
                  <th className="p-2.5 font-semibold text-right whitespace-nowrap">{lang === 'ja' ? '操作' : 'Action'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {entries.map((entry) => {
                  const m = entry.inspected;
                  const checked = batchSelectedIds.has(entry.id);
                  return (
                    <tr
                      key={entry.id}
                      className={`hover:bg-slate-50/80 dark:hover:bg-slate-900/40 ${checked ? 'bg-blue-50/30 dark:bg-blue-950/10' : ''}`}
                    >
                      <td className="p-2.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setBatchSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(entry.id)) next.delete(entry.id);
                              else next.add(entry.id);
                              return next;
                            });
                          }}
                          className="checkbox-field"
                        />
                      </td>
                      <td className="p-2.5 max-w-[200px]">
                        <div className="font-semibold text-slate-800 dark:text-slate-100 truncate" title={entry.file.name}>
                          {entry.file.name}
                        </div>
                        {m && (
                          <div className="text-[11px] text-slate-500 font-mono">
                            {m.extensionMismatch ? (
                              <span className="text-amber-600 dark:text-amber-400">
                                .{m.nameExtension} ≠ .{m.detectedFormat}
                              </span>
                            ) : (
                              <span>.{m.detectedFormat}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {(entry.file.size / 1024).toFixed(1)} KB
                      </td>
                      <td className="p-2.5 font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        <div>{new Date(entry.file.lastModified).toLocaleDateString()}</div>
                        {(m?.embeddedDates.original || m?.embeddedDates.created) && (
                          <div className="text-slate-400 truncate max-w-[130px]">
                            {m.embeddedDates.original || m.embeddedDates.created}
                          </div>
                        )}
                      </td>
                      <td className="p-2.5 font-mono tabular-nums text-[11px] whitespace-nowrap">
                        {m?.gps.found ? (
                          <span className="text-amber-600 dark:text-amber-400 font-semibold">
                            {m.gps.latitude?.toFixed(3)}, {m.gps.longitude?.toFixed(3)}
                          </span>
                        ) : (
                          <span className="text-slate-400">{lang === 'ja' ? 'なし' : '-'}</span>
                        )}
                      </td>
                      <td className="p-2.5 text-[11px] whitespace-nowrap">
                        {m?.c2pa.found ? (
                          <span className="text-blue-600 dark:text-blue-400 font-semibold">
                            {m.c2pa.generator || (lang === 'ja' ? '検出' : 'Yes')}
                          </span>
                        ) : (
                          <span className="text-slate-400">{lang === 'ja' ? 'なし' : '-'}</span>
                        )}
                      </td>
                      <td className="p-2.5 text-right whitespace-nowrap">
                        <button
                          onClick={() => {
                            setSelectedSingleId(entry.id);
                            setMode('single');
                          }}
                          className="text-blue-600 dark:text-blue-400 font-semibold hover:underline cursor-pointer"
                        >
                          {lang === 'ja' ? '個別詳細' : 'Inspect'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Batch Operations Configuration */}
          <div className="converter-settings flex flex-col gap-4">
            <div className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-100">
              {lang === 'ja' ? '一括編集・一括削除の設定' : 'Batch Edit & Removal Rules'}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              {/* Batch Rename */}
              <div className="flex flex-col gap-2">
                <label className="font-semibold text-slate-700 dark:text-slate-200 mb-0">
                  {lang === 'ja' ? 'ファイル名の一括編集' : 'Batch Rename'}
                </label>
                <select
                  value={batchRenameMode}
                  onChange={(e) => setBatchRenameMode(e.target.value as any)}
                  className="select-field text-xs"
                >
                  <option value="keep">{lang === 'ja' ? '変更しない' : 'Keep Original Names'}</option>
                  <option value="affix">{lang === 'ja' ? '接頭辞・接尾辞・置換' : 'Prefix / Suffix / Replace'}</option>
                  <option value="sequential">{lang === 'ja' ? '連番リネーム (file_001...)' : 'Sequential Numbering'}</option>
                  <option value="anonymize">{lang === 'ja' ? 'ランダム匿名化 (doc_001_xxxx)' : 'Anonymize Names'}</option>
                </select>
                {batchRenameMode === 'affix' && (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={batchPrefix}
                      onChange={(e) => setBatchPrefix(e.target.value)}
                      placeholder={lang === 'ja' ? '接頭辞 (例: 2026_)' : 'Prefix'}
                      className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                    <input
                      type="text"
                      value={batchSuffix}
                      onChange={(e) => setBatchSuffix(e.target.value)}
                      placeholder={lang === 'ja' ? '接尾辞 (例: _clean)' : 'Suffix'}
                      className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                    <input
                      type="text"
                      value={batchFind}
                      onChange={(e) => setBatchFind(e.target.value)}
                      placeholder={lang === 'ja' ? '置換前の文字' : 'Find'}
                      className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                    <input
                      type="text"
                      value={batchReplace}
                      onChange={(e) => setBatchReplace(e.target.value)}
                      placeholder={lang === 'ja' ? '置換後の文字' : 'Replace with'}
                      className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                )}
                {batchRenameMode === 'sequential' && (
                  <input
                    type="text"
                    value={batchSeqBase}
                    onChange={(e) => setBatchSeqBase(e.target.value)}
                    placeholder="file_"
                    className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                )}
              </div>

              {/* Batch Name Extension */}
              <div className="flex flex-col gap-2">
                <label className="font-semibold text-slate-700 dark:text-slate-200 mb-0">
                  {lang === 'ja' ? '名前上の拡張子の一括処理' : 'Batch Name Extension'}
                </label>
                <select
                  value={batchExtMode}
                  onChange={(e) => setBatchExtMode(e.target.value as any)}
                  className="select-field text-xs"
                >
                  <option value="keep">{lang === 'ja' ? '変更しない' : 'Keep Original Extensions'}</option>
                  <option value="autofix">{lang === 'ja' ? '実データの正しい拡張子に自動修正' : 'Auto-fix to Detected Format'}</option>
                  <option value="lowercase">{lang === 'ja' ? 'すべて小文字に統一' : 'Lowercase All Extensions'}</option>
                  <option value="set">{lang === 'ja' ? '指定の拡張子に変更' : 'Set Specific Extension'}</option>
                  <option value="remove">{lang === 'ja' ? '名前上の拡張子を削除' : 'Remove Extensions'}</option>
                </select>
                {batchExtMode === 'set' && (
                  <input
                    type="text"
                    value={batchExtValue}
                    onChange={(e) => setBatchExtValue(e.target.value)}
                    placeholder="jpg / png / txt..."
                    className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                  />
                )}
              </div>

              {/* Batch File Timestamp */}
              <div className="flex flex-col gap-2">
                <label className="font-semibold text-slate-700 dark:text-slate-200 mb-0">
                  {lang === 'ja' ? 'ファイル更新日時 (File Timestamp)' : 'File Last Modified'}
                </label>
                <select
                  value={batchLastModAction}
                  onChange={(e) => setBatchLastModAction(e.target.value as any)}
                  className="select-field text-xs"
                >
                  <option value="keep">{lang === 'ja' ? '変更しない' : 'Keep Original'}</option>
                  <option value="set">{lang === 'ja' ? '指定日時に統一' : 'Set Unified Date & Time'}</option>
                  <option value="shift">{lang === 'ja' ? '時間シフト (±時間)' : 'Shift by Hours'}</option>
                  <option value="reset">{lang === 'ja' ? 'リセット (2000-01-01)' : 'Reset to 2000-01-01'}</option>
                </select>
                {batchLastModAction === 'set' && (
                  <input
                    type="datetime-local"
                    value={batchLastModStr}
                    onChange={(e) => setBatchLastModStr(e.target.value)}
                    className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                  />
                )}
                {batchLastModAction === 'shift' && (
                  <input
                    type="number"
                    value={batchShiftHours}
                    onChange={(e) => setBatchShiftHours(e.target.value)}
                    placeholder="+9 or -9"
                    className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                  />
                )}
              </div>

              {/* Batch Embedded Dates */}
              <div className="flex flex-col gap-2">
                <label className="font-semibold text-slate-700 dark:text-slate-200 mb-0">
                  {lang === 'ja' ? '埋め込み日時 (EXIF / PDF / Office)' : 'Embedded Dates'}
                </label>
                <select
                  value={batchEmbeddedDateAction}
                  onChange={(e) => setBatchEmbeddedDateAction(e.target.value as any)}
                  className="select-field text-xs"
                >
                  <option value="keep">{lang === 'ja' ? '変更しない' : 'Keep Original'}</option>
                  <option value="delete">{lang === 'ja' ? '埋め込み日時を一括削除' : 'Delete Embedded Dates'}</option>
                  <option value="set">{lang === 'ja' ? '指定日時に一括統一' : 'Set Unified Embedded Date'}</option>
                </select>
                {batchEmbeddedDateAction === 'set' && (
                  <input
                    type="datetime-local"
                    value={batchEmbeddedDateStr}
                    onChange={(e) => setBatchEmbeddedDateStr(e.target.value)}
                    className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                  />
                )}
              </div>

              {/* Batch GPS */}
              <div className="flex flex-col gap-2">
                <label className="font-semibold text-slate-700 dark:text-slate-200 mb-0">
                  {lang === 'ja' ? '位置情報 (GPS)' : 'GPS Location'}
                </label>
                <select
                  value={batchGpsAction}
                  onChange={(e) => setBatchGpsAction(e.target.value as any)}
                  className="select-field text-xs"
                >
                  <option value="keep">{lang === 'ja' ? '変更しない' : 'Keep Original'}</option>
                  <option value="delete">{lang === 'ja' ? '位置情報を一括削除' : 'Strip All GPS Data'}</option>
                  <option value="set">{lang === 'ja' ? '指定座標に一括設定' : 'Set Unified GPS Coordinates'}</option>
                </select>
                {batchGpsAction === 'set' && (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      step="0.000001"
                      value={batchLat}
                      onChange={(e) => setBatchLat(e.target.value)}
                      placeholder="Lat (35.6812)"
                      className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                    />
                    <input
                      type="number"
                      step="0.000001"
                      value={batchLng}
                      onChange={(e) => setBatchLng(e.target.value)}
                      placeholder="Lng (139.7671)"
                      className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                    />
                  </div>
                )}
              </div>

              {/* Batch C2PA & Privacy */}
              <div className="flex flex-col gap-2">
                <label className="font-semibold text-slate-700 dark:text-slate-200 mb-0">
                  {lang === 'ja' ? 'C2PA・詳細メタデータ一括削除' : 'C2PA & Metadata Scrubbing'}
                </label>
                <div className="grid grid-cols-1 gap-2">
                  <select
                    value={batchC2paAction}
                    onChange={(e) => setBatchC2paAction(e.target.value as any)}
                    className="select-field text-xs"
                  >
                    <option value="keep">{lang === 'ja' ? 'C2PA: 維持' : 'C2PA: Keep'}</option>
                    <option value="delete">{lang === 'ja' ? 'C2PA: 一括削除' : 'C2PA: Strip All'}</option>
                  </select>
                  <select
                    value={batchDocMetaMode}
                    onChange={(e) => setBatchDocMetaMode(e.target.value as any)}
                    className="select-field text-xs"
                  >
                    <option value="keep">{lang === 'ja' ? 'その他タグ: 維持' : 'Other Metadata: Keep'}</option>
                    <option value="delete-personal">{lang === 'ja' ? '作成者・ソフト情報のみ一括削除' : 'Strip Author & Software'}</option>
                    <option value="scrub-all">{lang === 'ja' ? '全メタデータを完全削除 (EXIF/XMP/C2PA/GPS)' : 'Scrub ALL Embedded Metadata'}</option>
                  </select>
                </div>
              </div>
            </div>

            <label className="checkbox-row m-0">
              <input
                type="checkbox"
                checked={batchPreserveIcc}
                onChange={(e) => setBatchPreserveIcc(e.target.checked)}
                className="checkbox-field"
              />
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {lang === 'ja'
                  ? '全削除時も画像のカラープロファイル(ICC)と向き(Orientation)を保護する'
                  : 'Preserve ICC profile and image orientation when scrubbing'}
              </span>
            </label>
          </div>

          {isProcessingBatch && (
            <div className="progress-section m-0">
              <div className="progress-header">
                <span>{lang === 'ja' ? '一括処理中...' : 'Processing batch...'}</span>
                <span className="tabular-nums">{batchProgress}%</span>
              </div>
              <div className="progress-bar-bg">
                <div className="progress-bar-fill" style={{ width: `${batchProgress}%` }} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => executeBatch(false)}
              disabled={isProcessingBatch || batchSelectedIds.size === 0}
              className="btn btn-primary py-3 text-xs sm:text-sm"
            >
              <Check className="w-4 h-4" />
              <span>
                {lang === 'ja'
                  ? `選択中の ${batchSelectedIds.size} 件を一括処理してキューに追加`
                  : `Process ${batchSelectedIds.size} Selected to Queue`}
              </span>
            </button>

            <button
              onClick={() => executeBatch(true)}
              disabled={isProcessingBatch || batchSelectedIds.size === 0}
              className="btn py-3 text-xs sm:text-sm"
            >
              <FolderArchive className="w-4 h-4" />
              <span>
                {lang === 'ja'
                  ? `選択中の ${batchSelectedIds.size} 件を処理してZIP保存`
                  : `Process & Download as ZIP`}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Prompt Modal for adding locally uploaded single file to global queue */}
      <AddToQueuePromptModal
        file={pendingPromptFiles[0] || null}
        isOpen={pendingPromptFiles.length > 0}
        lang={lang}
        onConfirmAddToQueue={() => {
          if (onAddFiles && pendingPromptFiles.length > 0) {
            onAddFiles(pendingPromptFiles);
          }
          setPendingPromptFiles([]);
        }}
        onUseLocalOnly={() => {
          if (pendingPromptFiles.length > 0) {
            addLocalOnlyEntries(pendingPromptFiles);
          }
          setPendingPromptFiles([]);
        }}
      />
    </div>
  );
};
