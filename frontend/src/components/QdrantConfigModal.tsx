import React, { useState, useEffect } from 'react';
import {
  X,
  Database,
  Server,
  HardDrive,
  Key,
  Folder,
  Layers,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Save,
  Cpu,
  RefreshCw,
} from 'lucide-react';
import type { QdrantConfig, QdrantTestResponse } from '../types';
import { getQdrantConfig, saveQdrantConfig, testQdrantConnection } from '../api/client';

interface QdrantConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (cfg: QdrantConfig) => void;
}

export const QdrantConfigModal: React.FC<QdrantConfigModalProps> = ({
  isOpen,
  onClose,
  onSaved,
}) => {
  const [config, setConfig] = useState<QdrantConfig>({
    mode: 'embedded',
    local_path: 'output/qdrant_db',
    url: 'http://localhost:6333',
    api_key: '',
    collection_name: 'mineru_chunks',
    recreate_collection: false,
    dense_model_name: 'dragonkue/BGE-m3-ko',
    dense_dim: 1024,
    batch_size: 16,
    dense_vector_name: 'dense',
    sparse_vector_name: 'sparse',
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<QdrantTestResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setTestResult(null);
    try {
      const data = await getQdrantConfig();
      setConfig({
        ...data,
        dense_vector_name: data.dense_vector_name || 'dense',
        sparse_vector_name: data.sparse_vector_name || 'sparse',
      });
    } catch (err: any) {
      setErrorMsg(err.message || '설정을 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    setErrorMsg(null);
    try {
      const res = await testQdrantConnection({
        mode: config.mode,
        local_path: config.local_path,
        url: config.url,
        api_key: config.api_key,
      });
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        success: false,
        mode: config.mode,
        target: config.mode === 'embedded' ? config.local_path : config.url || '',
        message: err.message || '연결 실패',
        error: err.message,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    const denseName = (config.dense_vector_name || '').trim();
    const sparseName = (config.sparse_vector_name || '').trim();

    if (!denseName) {
      setErrorMsg('Dense 벡터 이름을 입력해주세요. (기본값: dense)');
      return;
    }
    if (!sparseName) {
      setErrorMsg('Sparse 벡터 이름을 입력해주세요. (기본값: sparse)');
      return;
    }
    if (denseName === sparseName) {
      setErrorMsg('Dense 벡터 이름과 Sparse 벡터 이름은 서로 달라야 합니다.');
      return;
    }

    const payloadToSave: QdrantConfig = {
      ...config,
      dense_vector_name: denseName,
      sparse_vector_name: sparseName,
    };

    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await saveQdrantConfig(payloadToSave);
      setSuccessMsg('Qdrant 설정이 성공적으로 저장되었습니다.');
      if (onSaved) onSaved(res.config);
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err: any) {
      setErrorMsg(err.message || '설정 저장 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] transition-colors">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/60">
              <Database className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Qdrant 벡터 DB 연동 설정</h2>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                  하이브리드 검색
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Dense(BGE-m3) & Sparse(Kiwi Modifier.IDF) 벡터 저장을 위한 Qdrant 구성
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 text-xs">
          {/* Messages */}
          {errorMsg && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <span className="font-medium">{errorMsg}</span>
            </div>
          )}
          {successMsg && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-xl flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="font-medium">{successMsg}</span>
            </div>
          )}

          {/* 1. Execution Mode Selection */}
          <div className="space-y-2">
            <label className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              Qdrant 실행 모드
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setConfig({ ...config, mode: 'embedded' })}
                className={`p-3.5 rounded-xl border text-left flex flex-col transition cursor-pointer ${
                  config.mode === 'embedded'
                    ? 'bg-indigo-50/80 dark:bg-indigo-950/50 border-indigo-500 text-slate-900 dark:text-slate-100 shadow-xs ring-1 ring-indigo-500/50'
                    : 'bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-sm text-slate-800 dark:text-slate-200">
                    <HardDrive className={`w-4 h-4 ${config.mode === 'embedded' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
                    <span>로컬 내장 모드</span>
                  </div>
                  {config.mode === 'embedded' && (
                    <span className="text-[10px] font-bold bg-indigo-600 text-white px-1.5 py-0.5 rounded">
                      선택됨
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  별도 서버 구동 없이 파일 DB로 즉시 인덱싱 및 테스트 (기본값)
                </span>
              </button>

              <button
                type="button"
                onClick={() => setConfig({ ...config, mode: 'remote' })}
                className={`p-3.5 rounded-xl border text-left flex flex-col transition cursor-pointer ${
                  config.mode === 'remote'
                    ? 'bg-indigo-50/80 dark:bg-indigo-950/50 border-indigo-500 text-slate-900 dark:text-slate-100 shadow-xs ring-1 ring-indigo-500/50'
                    : 'bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-sm text-slate-800 dark:text-slate-200">
                    <Server className={`w-4 h-4 ${config.mode === 'remote' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
                    <span>원격 서버 모드</span>
                  </div>
                  {config.mode === 'remote' && (
                    <span className="text-[10px] font-bold bg-indigo-600 text-white px-1.5 py-0.5 rounded">
                      선택됨
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Docker 인스턴스 또는 Qdrant Cloud 클러스터 연결
                </span>
              </button>
            </div>
          </div>

          {/* 2. Mode-specific Details */}
          {config.mode === 'embedded' ? (
            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
              <label className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                로컬 스토리지 경로 (Storage Path)
              </label>
              <input
                type="text"
                value={config.local_path}
                onChange={(e) => setConfig({ ...config, local_path: e.target.value })}
                className="w-full font-mono text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                placeholder="output/qdrant_db"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                프로젝트 루트 기준 상대 경로 또는 절대 경로를 지정합니다.
              </p>
            </div>
          ) : (
            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  Qdrant 서버 URL
                </label>
                <input
                  type="text"
                  value={config.url || ''}
                  onChange={(e) => setConfig({ ...config, url: e.target.value })}
                  className="w-full font-mono text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  placeholder="http://localhost:6333 또는 https://xxx.cloud.qdrant.io:6333"
                />
              </div>
              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  API Key (선택 사항)
                </label>
                <input
                  type="password"
                  value={config.api_key || ''}
                  onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
                  className="w-full font-mono text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  placeholder="Qdrant Cloud 등 인증이 필요한 경우 입력"
                />
              </div>
            </div>
          )}

          {/* 3. Collection & Indexing Policy */}
          <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-4">
            <div className="space-y-1.5">
              <label className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                대상 컬렉션 이름 (Collection Name)
              </label>
              <input
                type="text"
                value={config.collection_name}
                onChange={(e) => setConfig({ ...config, collection_name: e.target.value })}
                className="w-full font-mono text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-semibold"
                placeholder="mineru_chunks"
              />
            </div>

            {/* Vector Names (Dense & Sparse) */}
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 text-xs">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  벡터 이름 설정 (Vector Names)
                </label>
                <span className="text-[10px] text-slate-400 dark:text-slate-500">
                  기본값: dense, sparse
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                    Dense 벡터 이름
                  </span>
                  <input
                    type="text"
                    value={config.dense_vector_name || ''}
                    onChange={(e) => setConfig({ ...config, dense_vector_name: e.target.value })}
                    className="w-full font-mono text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    placeholder="dense"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    Sparse 벡터 이름
                  </span>
                  <input
                    type="text"
                    value={config.sparse_vector_name || ''}
                    onChange={(e) => setConfig({ ...config, sparse_vector_name: e.target.value })}
                    className="w-full font-mono text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    placeholder="sparse"
                  />
                </div>
              </div>
              <p className="text-[10.5px] text-slate-500 dark:text-slate-400 leading-normal">
                Qdrant 컬렉션 생성, 색인 및 RRF 융합 검색 시 식별자로 사용되는 Named Vector 이름입니다.
              </p>
            </div>

            <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 cursor-pointer select-none hover:bg-slate-100/70 dark:hover:bg-slate-800 transition">
              <input
                type="checkbox"
                checked={config.recreate_collection}
                onChange={(e) => setConfig({ ...config, recreate_collection: e.target.checked })}
                className="w-4 h-4 rounded text-indigo-600 border-slate-300 dark:border-slate-600 focus:ring-indigo-500"
              />
              <div className="flex-1">
                <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                  인덱싱 실행 시 컬렉션 재생성 (Recreate)
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                  체크 시 기존 컬렉션을 삭제하고 새로 생성합니다. 해제 시 기존 데이터를 보존하며 업데이트합니다.
                </span>
              </div>
            </label>
          </div>

          {/* 4. Embedding Specs Card */}
          <div className="p-3.5 bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/70 rounded-xl space-y-1.5">
            <div className="text-xs font-bold text-indigo-900 dark:text-indigo-300 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>하이브리드 인코딩 사양</span>
            </div>
            <div className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed space-y-0.5">
              <p>
                • <strong className="text-slate-800 dark:text-slate-100">Dense</strong>: {config.dense_model_name} ({config.dense_dim}차원, Mac MPS 가속)
                <span className="ml-1 text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold font-mono">
                  [벡터명: {config.dense_vector_name || 'dense'}]
                </span>
              </p>
              <p>
                • <strong className="text-slate-800 dark:text-slate-100">Sparse</strong>: Kiwi 형태소 + SHA256 uint32 해시 + Qdrant Modifier.IDF
                <span className="ml-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold font-mono">
                  [벡터명: {config.sparse_vector_name || 'sparse'}]
                </span>
              </p>
            </div>
          </div>

          {/* 5. Connection Test Result Card */}
          {testResult && (
            <div
              className={`p-3.5 rounded-xl border flex items-start gap-2.5 ${
                testResult.success
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                  : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold">
                    {testResult.success ? '연결 성공' : '연결 실패'}
                  </span>
                  <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                    모드: {testResult.mode}
                  </span>
                </div>
                <p className="mt-1 text-[11px]">{testResult.message}</p>
                {testResult.success && testResult.collections && (
                  <div className="mt-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                    기존 컬렉션: {testResult.collections.length > 0 ? testResult.collections.join(', ') : '없음 (새로 생성 예정)'}
                  </div>
                )}
                {testResult.error && (
                  <p className="mt-1 text-[10px] font-mono text-rose-700 dark:text-rose-300 break-all">
                    {testResult.error}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/80 flex items-center justify-between">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={isTesting || isLoading}
            className="px-3.5 py-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-800 rounded-xl transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-2xs"
          >
            {isTesting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600 dark:text-indigo-400" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            )}
            <span>{isTesting ? '연결 테스트 중...' : '연결 테스트'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-xl transition cursor-pointer"
            >
              닫기
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isLoading || isTesting}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>설정 저장</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
