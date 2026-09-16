import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Archive,
  RotateCcw,
  Download,
  Trash2,
  PlusCircle,
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RefreshCw,
  HardDrive,
  Database,
  Layers,
  ShieldCheck,
  Calendar,
  Sparkles,
} from 'lucide-react';
import type { BackupItem, CreateBackupRequest } from '../types';
import {
  getBackupList,
  createBackup,
  restoreBackup,
  deleteBackup,
  uploadBackup,
} from '../api/client';

interface BackupRestoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  activePdf?: string;
  pdfList: { filename: string }[];
  onRestoreSuccess: () => Promise<void>;
}

type TabType = 'list' | 'create' | 'upload';

export const BackupRestoreModal: React.FC<BackupRestoreModalProps> = ({
  isOpen,
  onClose,
  activePdf,
  pdfList,
  onRestoreSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('list');
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Create form state
  const [backupName, setBackupName] = useState('');
  const [backupDesc, setBackupDesc] = useState('');
  const [backupType, setBackupType] = useState<'workspace' | 'document'>('workspace');
  const [targetDoc, setTargetDoc] = useState(activePdf || (pdfList[0]?.filename ?? ''));
  const [includeVectorDb, setIncludeVectorDb] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // Restore confirm modal state
  const [restoreTarget, setRestoreTarget] = useState<BackupItem | null>(null);
  const [createSafetyBeforeRestore, setCreateSafetyBeforeRestore] = useState(true);
  const [isRestoring, setIsRestoring] = useState(false);

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<BackupItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [restoreImmediately, setRestoreImmediately] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Format file size
  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Format timestamp
  const formatDate = (isoOrTs: string | number) => {
    if (!isoOrTs) return '-';
    try {
      const d = typeof isoOrTs === 'number' ? new Date(isoOrTs * 1000) : new Date(isoOrTs);
      return d.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return String(isoOrTs);
    }
  };

  const fetchBackups = async () => {
    setIsLoading(true);
    setActionError(null);
    try {
      const res = await getBackupList();
      if (res.success) {
        setBackups(res.backups || []);
      }
    } catch (err: any) {
      setActionError(err.message || '백업 목록 로드 실패');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchBackups();
      setActionError(null);
      setActionSuccess(null);
      // Auto-suggest backup name
      const nowStr = new Date().toLocaleString('ko-KR', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      setBackupName(`작업 백업 (${nowStr})`);
      if (activePdf) {
        setTargetDoc(activePdf);
      }
    }
  }, [isOpen, activePdf]);

  if (!isOpen) return null;

  // Handle Create Backup
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const req: CreateBackupRequest = {
        name: backupName.trim() || undefined,
        description: backupDesc.trim() || undefined,
        backup_type: backupType,
        target_doc: backupType === 'document' ? targetDoc : undefined,
        include_vector_db: includeVectorDb,
      };
      const res = await createBackup(req);
      if (res.success) {
        setActionSuccess(`백업 '${res.manifest.name}'이(가) 성공적으로 생성되었습니다.`);
        setBackupDesc('');
        await fetchBackups();
        setActiveTab('list');
      }
    } catch (err: any) {
      setActionError(err.message || '백업 생성에 실패했습니다.');
    } finally {
      setIsCreating(false);
    }
  };

  // Handle Restore
  const handleConfirmRestore = async () => {
    if (!restoreTarget) return;
    setIsRestoring(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await restoreBackup(restoreTarget.backup_id, createSafetyBeforeRestore);
      if (res.success) {
        setActionSuccess(
          `'${restoreTarget.name}' 백업으로 원복되었습니다. (복원 파일: ${res.result.restored_files_count}개)`
        );
        setRestoreTarget(null);
        await onRestoreSuccess();
        await fetchBackups();
      }
    } catch (err: any) {
      setActionError(err.message || '원복 실행 중 오류가 발생했습니다.');
    } finally {
      setIsRestoring(false);
    }
  };

  // Handle Delete
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await deleteBackup(deleteTarget.backup_id);
      if (res.success) {
        setActionSuccess(`'${deleteTarget.name}' 백업이 삭제되었습니다.`);
        setDeleteTarget(null);
        await fetchBackups();
      }
    } catch (err: any) {
      setActionError(err.message || '백업 삭제 실패');
    } finally {
      setIsDeleting(false);
    }
  };

  // Handle Upload
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;

    setIsUploading(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await uploadBackup(uploadFile, restoreImmediately);
      if (res.success) {
        setActionSuccess(
          restoreImmediately
            ? `백업 파일을 가져오고 즉시 원복을 완료했습니다.`
            : `백업 파일이 성공적으로 목록에 등록되었습니다.`
        );
        setUploadFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (restoreImmediately) {
          await onRestoreSuccess();
        }
        await fetchBackups();
        setActiveTab('list');
      }
    } catch (err: any) {
      setActionError(err.message || '백업 파일 가져오기 실패');
    } finally {
      setIsUploading(false);
    }
  };

  // Drag & drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const f = e.dataTransfer.files[0];
      if (f.name.endsWith('.zip')) {
        setUploadFile(f);
      } else {
        setActionError('ZIP 형식의 백업 파일만 업로드할 수 있습니다.');
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200 select-none">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-950/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
              <Archive className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  작업공간 백업 & 원복 관리
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-semibold">
                  Snapshot
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                PDF 문서, MinerU ETL 파싱/교정본 및 시스템 설정을 안전하게 스냅샷 백업하고 원복합니다.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
            title="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Global Feedback Banners */}
        {actionSuccess && (
          <div className="px-5 py-2.5 bg-emerald-50 dark:bg-emerald-950/50 border-b border-emerald-200 dark:border-emerald-800/60 flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-300 animate-in fade-in duration-150">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{actionSuccess}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionSuccess(null)}
              className="text-emerald-600 hover:text-emerald-800 cursor-pointer text-xs"
            >
              닫기
            </button>
          </div>
        )}

        {actionError && (
          <div className="px-5 py-2.5 bg-rose-50 dark:bg-rose-950/50 border-b border-rose-200 dark:border-rose-800/60 flex items-center justify-between text-xs text-rose-800 dark:text-rose-300 animate-in fade-in duration-150">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              <span>{actionError}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-rose-600 hover:text-rose-800 cursor-pointer text-xs"
            >
              닫기
            </button>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="px-5 pt-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('list')}
              className={`px-3.5 py-2 text-xs font-semibold rounded-t-xl transition-all border-b-2 flex items-center gap-2 cursor-pointer ${
                activeTab === 'list'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/40'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>백업 목록 & 원복</span>
              <span className="text-[10px] px-1.5 py-0.2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-full font-mono">
                {backups.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('create')}
              className={`px-3.5 py-2 text-xs font-semibold rounded-t-xl transition-all border-b-2 flex items-center gap-2 cursor-pointer ${
                activeTab === 'create'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/40'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>새 백업 만들기</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('upload')}
              className={`px-3.5 py-2 text-xs font-semibold rounded-t-xl transition-all border-b-2 flex items-center gap-2 cursor-pointer ${
                activeTab === 'upload'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/40'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>백업 파일 가져오기</span>
            </button>
          </div>

          <button
            type="button"
            onClick={fetchBackups}
            disabled={isLoading}
            className="text-xs p-1.5 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition cursor-pointer"
            title="새로고침"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* TAB 1: BACKUP LIST & RESTORE */}
          {activeTab === 'list' && (
            <div className="space-y-3">
              {isLoading && backups.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400">
                  <Loader2 className="w-7 h-7 animate-spin mb-2 text-indigo-500" />
                  <span className="text-xs">백업 목록을 불러오는 중...</span>
                </div>
              ) : backups.length === 0 ? (
                <div className="py-14 flex flex-col items-center justify-center text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl p-6">
                  <Archive className="w-10 h-10 text-slate-300 dark:text-slate-600 mb-3" />
                  <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">
                    저장된 백업이 없습니다.
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mb-4">
                    현재 작업 중인 데이터와 환경을 안전하게 보관하려면 [새 백업 만들기]를 클릭해 스냅샷을 생성하세요.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('create')}
                    className="px-3.5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>지금 백업 만들기</span>
                  </button>
                </div>
              ) : (
                backups.map((item) => {
                  const isSafety = item.is_safety_backup;
                  const isDoc = item.backup_type === 'document';

                  return (
                    <div
                      key={item.backup_id}
                      className={`p-4 rounded-xl border transition-all ${
                        isSafety
                          ? 'border-amber-200/80 dark:border-amber-900/50 bg-amber-50/30 dark:bg-amber-950/20'
                          : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900/60'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1.5 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {isSafety ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700/60">
                                <ShieldCheck className="w-3 h-3" />
                                안전 백업
                              </span>
                            ) : isDoc ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                <FileText className="w-3 h-3" />
                                단일 문서
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                <HardDrive className="w-3 h-3" />
                                전체 작업공간
                              </span>
                            )}

                            <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                              {item.name}
                            </h4>

                            <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
                              {formatBytes(item.size_bytes)}
                            </span>
                          </div>

                          {item.description && (
                            <p className="text-xs text-slate-600 dark:text-slate-300">
                              {item.description}
                            </p>
                          )}

                          {/* Stats and Date pills */}
                          <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-slate-400" />
                              {formatDate(item.created_at || item.timestamp)}
                            </span>

                            <span className="flex items-center gap-1">
                              <FileText className="w-3 h-3 text-slate-400" />
                              PDF {item.stats?.pdf_count ?? 0}개
                            </span>

                            {(item.stats?.total_chunks ?? 0) > 0 && (
                              <span className="flex items-center gap-1 font-mono">
                                <Layers className="w-3 h-3 text-indigo-400" />
                                청크 {item.stats?.total_chunks}개
                              </span>
                            )}

                            {item.stats?.includes_vector_db && (
                              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                                <Database className="w-3 h-3" />
                                벡터 DB 포함
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                          {/* Restore Button */}
                          <button
                            type="button"
                            onClick={() => setRestoreTarget(item)}
                            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                            title="이 백업 시점으로 작업공간 데이터 원복"
                          >
                            <RotateCcw className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                            <span>원복하기</span>
                          </button>

                          {/* Download Button */}
                          <a
                            href={`/api/backup/${encodeURIComponent(item.backup_id)}/download`}
                            download={item.filename || `${item.backup_id}.zip`}
                            className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition border border-slate-200 dark:border-slate-700 cursor-pointer"
                            title="백업 ZIP 파일 다운로드"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>

                          {/* Delete Button */}
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(item)}
                            className="p-2 rounded-xl text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition border border-transparent hover:border-rose-200 dark:hover:border-rose-800 cursor-pointer"
                            title="백업 삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 2: CREATE BACKUP */}
          {activeTab === 'create' && (
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="p-3.5 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/60 text-xs text-indigo-900 dark:text-indigo-200 flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                <p>
                  백업을 생성하면 현재 <code className="font-mono bg-indigo-100 dark:bg-indigo-900 px-1 py-0.5 rounded">pdfs/</code> 문서와{' '}
                  <code className="font-mono bg-indigo-100 dark:bg-indigo-900 px-1 py-0.5 rounded">output/</code>의 MinerU 파싱 산출물,
                  사용자 편집 청크(<code className="font-mono">rag_chunks_edited.json</code>), LLM 및 Qdrant 설정이 단일 ZIP 아카이브로 안전하게 보관됩니다.
                </p>
              </div>

              {/* Backup Name */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  백업 이름 <span className="text-indigo-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={backupName}
                  onChange={(e) => setBackupName(e.target.value)}
                  placeholder="예: 2026-09-16 법률 시행령 청크 교정 완료 후 백업"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  설명 및 메모 (선택)
                </label>
                <textarea
                  rows={2}
                  value={backupDesc}
                  onChange={(e) => setBackupDesc(e.target.value)}
                  placeholder="백업 시점의 특이사항이나 작업 내용을 자유롭게 기록하세요."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>

              {/* Backup Scope */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  백업 대상 범위
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <label
                    className={`p-3 rounded-xl border cursor-pointer transition flex items-start gap-2.5 ${
                      backupType === 'workspace'
                        ? 'border-indigo-600 bg-indigo-50/40 dark:bg-indigo-950/40 ring-1 ring-indigo-500'
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="backupType"
                      checked={backupType === 'workspace'}
                      onChange={() => setBackupType('workspace')}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <span className="text-xs font-bold block text-slate-800 dark:text-slate-200">
                        전체 작업공간 백업 (권장)
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                        모든 PDF 문서와 파싱 산출물, 전체 교정본 및 시스템 설정 보관
                      </span>
                    </div>
                  </label>

                  <label
                    className={`p-3 rounded-xl border cursor-pointer transition flex items-start gap-2.5 ${
                      backupType === 'document'
                        ? 'border-indigo-600 bg-indigo-50/40 dark:bg-indigo-950/40 ring-1 ring-indigo-500'
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="backupType"
                      checked={backupType === 'document'}
                      onChange={() => setBackupType('document')}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <span className="text-xs font-bold block text-slate-800 dark:text-slate-200">
                        단일 문서 백업
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                        선택한 특정 PDF 문서와 해당 문서의 산출물/교정본만 보관
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Target Document Selector if single doc */}
              {backupType === 'document' && (
                <div className="space-y-1.5 animate-in fade-in duration-150">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    백업할 대상 문서 선택
                  </label>
                  <select
                    value={targetDoc}
                    onChange={(e) => setTargetDoc(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {pdfList.map((p) => (
                      <option key={p.filename} value={p.filename}>
                        {p.filename}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Vector DB Inclusion Option */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeVectorDb}
                    onChange={(e) => setIncludeVectorDb(e.target.checked)}
                    className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-indigo-500" />
                      Qdrant 로컬 벡터 DB (`output/qdrant_db`) 포함
                    </span>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      체크 해제 시 가볍고 빠르게 백업이 완료되며, 복원 후 필요 시 언제든 다시 원클릭 색인할 수 있습니다.
                    </p>
                  </div>
                </label>
              </div>

              {/* Submit Button */}
              <div className="pt-3 flex justify-end">
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>백업 압축 생성 중...</span>
                    </>
                  ) : (
                    <>
                      <Archive className="w-4 h-4" />
                      <span>백업 생성하기</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: UPLOAD BACKUP ZIP */}
          {activeTab === 'upload' && (
            <form onSubmit={handleUploadSubmit} className="space-y-4">
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300">
                외부 PC나 백업 저장소에 보관 중이던 <code className="font-mono font-semibold">.zip</code> 백업 파일을 업로드하여 스튜디오 목록에 등록하거나 즉시 작업공간으로 원복합니다.
              </div>

              {/* Dropzone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center ${
                  isDragging
                    ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/40'
                    : uploadFile
                    ? 'border-emerald-500/80 bg-emerald-50/30 dark:bg-emerald-950/20'
                    : 'border-slate-200 dark:border-slate-800 hover:border-indigo-400 hover:bg-slate-50/50 dark:hover:bg-slate-800/40'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".zip"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      setUploadFile(e.target.files[0]);
                    }
                  }}
                />

                {uploadFile ? (
                  <div className="flex flex-col items-center gap-2">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                    <div>
                      <span className="text-sm font-bold text-slate-800 dark:text-slate-200 block">
                        {uploadFile.name}
                      </span>
                      <span className="text-xs text-slate-500 font-mono">
                        {formatBytes(uploadFile.size)}
                      </span>
                    </div>
                    <span className="text-[11px] text-indigo-600 dark:text-indigo-400 underline mt-1">
                      다른 파일 선택
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <UploadCloud className="w-10 h-10 text-slate-400" />
                    <div>
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                        ZIP 백업 파일을 드래그하여 놓거나 클릭하여 선택
                      </span>
                      <span className="text-[11px] text-slate-400 block mt-0.5">
                        MinerU Studio에서 생성된 백업 ZIP 아카이브 지원
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Immediate Restore Option */}
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restoreImmediately}
                    onChange={(e) => setRestoreImmediately(e.target.checked)}
                    className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <RotateCcw className="w-3.5 h-3.5 text-indigo-500" />
                      업로드 완료 후 즉시 작업공간으로 원복(복원) 실행
                    </span>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      체크 시 파일 등록과 동시에 현재 작업공간을 이 백업 파일의 상태로 동기화합니다. (원복 전 안전 백업 자동 생성)
                    </p>
                  </div>
                </label>
              </div>

              {/* Submit Button */}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={!uploadFile || isUploading}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>업로드 및 등록 중...</span>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="w-4 h-4" />
                      <span>{restoreImmediately ? '업로드 & 즉시 원복' : '백업 파일 가져오기'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* RESTORE CONFIRMATION DIALOG MODAL (Overlaid) */}
        {restoreTarget && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4">
              <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                    작업공간 원복(복원) 확인
                  </h4>
                  <p className="text-xs text-slate-500">백업 시점으로 데이터를 덮어씁니다.</p>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">복원 대상:</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-[200px]">
                    {restoreTarget.name}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">생성 일시:</span>
                  <span className="text-slate-700 dark:text-slate-300">
                    {formatDate(restoreTarget.created_at || restoreTarget.timestamp)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">포함 문서:</span>
                  <span className="text-slate-700 dark:text-slate-300">
                    {restoreTarget.stats?.pdf_count ?? 0}개 PDF
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-900/50">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createSafetyBeforeRestore}
                    onChange={(e) => setCreateSafetyBeforeRestore(e.target.checked)}
                    className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <span className="text-xs font-bold text-amber-900 dark:text-amber-200">
                      원복 전 현재 상태 자동 안전 백업 생성 (권장)
                    </span>
                    <p className="text-[11px] text-amber-700/80 dark:text-amber-400 mt-0.5">
                      원복 직전 현재 데이터를 별도 백업하므로 언제든 원복 이전으로 되돌릴 수 있습니다.
                    </p>
                  </div>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRestoreTarget(null)}
                  disabled={isRestoring}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRestore}
                  disabled={isRestoring}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isRestoring ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>원복 진행 중...</span>
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>원복 실행하기</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DELETE CONFIRMATION DIALOG MODAL (Overlaid) */}
        {deleteTarget && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
              <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400">
                <div className="w-9 h-9 rounded-xl bg-rose-500/15 flex items-center justify-center">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">백업 삭제</h4>
                  <p className="text-xs text-slate-500">저장된 백업 파일을 영구 삭제합니다.</p>
                </div>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300">
                <span className="font-bold">'{deleteTarget.name}'</span> 백업 아카이브를 삭제하시겠습니까? 삭제된 백업은 복구할 수 없습니다.
              </p>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  disabled={isDeleting}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>삭제 중...</span>
                    </>
                  ) : (
                    <span>삭제하기</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
