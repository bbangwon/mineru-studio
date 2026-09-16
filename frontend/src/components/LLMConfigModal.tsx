import React, { useState, useEffect } from 'react';
import {
  X,
  Bot,
  Sparkles,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Save,
  Server,
  Key,
  Thermometer,
  FileText,
  Clock,
  ChevronDown,
} from 'lucide-react';
import type { LLMConfig, LLMTestResponse } from '../types';
import {
  getLLMConfig,
  saveLLMConfig,
  getDefaultSystemPrompt,
  testLLMConnection,
  getLLMModels,
} from '../api/client';

interface LLMConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (cfg: LLMConfig) => void;
}

const PRESET_MODELS = [
  { id: 'gemma4:12b-mlx', label: 'gemma4:12b-mlx (권장/기본)' },
  { id: 'qwen2.5:7b', label: 'qwen2.5:7b' },
  { id: 'exaone3.5:7.8b', label: 'exaone3.5:7.8b' },
  { id: 'llama3.1:8b', label: 'llama3.1:8b' },
];

export const LLMConfigModal: React.FC<LLMConfigModalProps> = ({
  isOpen,
  onClose,
  onSaved,
}) => {
  const [config, setConfig] = useState<LLMConfig>({
    base_url: 'http://localhost:11434/v1',
    model_name: 'gemma4:12b-mlx',
    temperature: 0.0,
    api_key: '',
    max_tokens: 2048,
    timeout: 60,
    system_prompt: '',
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<LLMTestResponse | null>(null);
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
      const data = await getLLMConfig();
      setConfig(data);
    } catch (err: any) {
      setErrorMsg(err.message || 'LLM 설정을 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestoreDefaultPrompt = async () => {
    try {
      const res = await getDefaultSystemPrompt();
      setConfig((prev) => ({ ...prev, system_prompt: res.default_prompt }));
      setSuccessMsg('기본 권장 시스템 프롬프트로 복원되었습니다.');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || '기본 프롬프트를 불러오지 못했습니다.');
    }
  };

  const handleFetchModels = async () => {
    setIsFetchingModels(true);
    setErrorMsg(null);
    try {
      const res = await getLLMModels(config.base_url, config.api_key);
      if (res.models && res.models.length > 0) {
        setFetchedModels(res.models);
        setSuccessMsg(`${res.models.length}개의 모델 목록을 탐색했습니다.`);
        setTimeout(() => setSuccessMsg(null), 3000);
      } else {
        setErrorMsg('엔드포인트에서 검색된 모델이 없습니다. URL을 확인하세요.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || '모델 목록 탐색 실패');
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    setErrorMsg(null);
    try {
      const res = await testLLMConnection({
        base_url: config.base_url,
        model_name: config.model_name,
        temperature: config.temperature,
        api_key: config.api_key,
        timeout: config.timeout,
      });
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        success: false,
        model: config.model_name,
        message: err.message || '연결 실패',
        error: err.message,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await saveLLMConfig(config);
      setSuccessMsg('LLM 설정이 영속 저장되었습니다.');
      if (onSaved) onSaved(res.config);
      setTimeout(() => {
        onClose();
      }, 600);
    } catch (err: any) {
      setErrorMsg(err.message || '설정 저장 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden transition-colors">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 rounded-xl border border-indigo-100 dark:border-indigo-900/60">
              <Bot className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">LLM 텍스트 교정 설정</h3>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                  OpenAI 호환 API
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                청크 텍스트의 비정상 줄바꿈 및 띄어쓰기 오류를 로컬 LLM으로 자동 정제합니다.
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

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-xs">
          {/* Notification Messages */}
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span className="font-medium">{errorMsg}</span>
            </div>
          )}
          {successMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span className="font-medium">{successMsg}</span>
            </div>
          )}

          {/* 1. Base URL */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-700 flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-indigo-600" />
              Base URL (API 엔드포인트)
            </label>
            <input
              type="text"
              value={config.base_url}
              onChange={(e) => setConfig({ ...config, base_url: e.target.value })}
              placeholder="http://localhost:11434/v1"
              className="w-full font-mono text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-[11px] text-slate-500">
              기본값: Ollama (<code className="bg-slate-100 px-1 rounded">http://localhost:11434/v1</code>), LM Studio (<code className="bg-slate-100 px-1 rounded">http://localhost:1234/v1</code>), vLLM 등
            </p>
          </div>

          {/* 2. Model Name & Presets */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-bold text-slate-700 flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5 text-indigo-600" />
                모델 이름 (Model Name)
              </label>
              <button
                type="button"
                onClick={handleFetchModels}
                disabled={isFetchingModels}
                className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1 hover:underline cursor-pointer disabled:opacity-50"
              >
                {isFetchingModels ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
                <span>서버 모델 목록 탐색</span>
              </button>
            </div>

            <input
              type="text"
              value={config.model_name}
              onChange={(e) => setConfig({ ...config, model_name: e.target.value })}
              placeholder="gemma4:12b-mlx"
              className="w-full font-mono text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-semibold"
            />

            {/* Fetched Models Quick Selector */}
            {fetchedModels.length > 0 && (
              <div className="p-2 bg-indigo-50/70 border border-indigo-100 rounded-lg space-y-1">
                <span className="text-[10px] font-bold text-indigo-900 block">탐색된 모델에서 선택:</span>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {fetchedModels.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setConfig({ ...config, model_name: m })}
                      className={`text-[11px] font-mono px-2 py-0.5 rounded border transition cursor-pointer ${
                        config.model_name === m
                          ? 'bg-indigo-600 text-white border-indigo-600 font-bold'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-indigo-100/60'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Recommended Model Preset Chips */}
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              <span className="text-[11px] text-slate-400 font-medium">추천 프리셋:</span>
              {PRESET_MODELS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setConfig({ ...config, model_name: p.id })}
                  className={`text-[11px] px-2 py-1 rounded-md transition cursor-pointer border ${
                    config.model_name === p.id
                      ? 'bg-indigo-600 text-white border-indigo-600 font-bold'
                      : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* 3. Temperature & Optional Configs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-3.5 bg-slate-50 rounded-xl border border-slate-200">
            {/* Temperature */}
            <div className="space-y-1">
              <label className="font-bold text-slate-700 flex items-center gap-1">
                <Thermometer className="w-3.5 h-3.5 text-amber-600" />
                <span>온도 (Temperature)</span>
              </label>
              <input
                type="number"
                min="0.0"
                max="2.0"
                step="0.1"
                value={config.temperature}
                onChange={(e) =>
                  setConfig({ ...config, temperature: parseFloat(e.target.value) || 0.0 })
                }
                className="w-full text-xs font-mono font-bold bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-[10px] text-slate-500">
                기본값 <strong>0.0</strong> (Greedy Decoding / 100% 결정론적 텍스트 정제)
              </p>
            </div>

            {/* Max Tokens */}
            <div className="space-y-1">
              <label className="font-bold text-slate-700 flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-slate-600" />
                <span>최대 토큰 (Max Tokens)</span>
              </label>
              <input
                type="number"
                min="256"
                max="8192"
                step="256"
                value={config.max_tokens}
                onChange={(e) =>
                  setConfig({ ...config, max_tokens: parseInt(e.target.value, 10) || 2048 })
                }
                className="w-full text-xs font-mono bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-[10px] text-slate-500">청크 크기에 맞추어 2048 토큰 권장</p>
            </div>

            {/* Timeout */}
            <div className="space-y-1">
              <label className="font-bold text-slate-700 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-600" />
                <span>타임아웃 (Timeout 초)</span>
              </label>
              <input
                type="number"
                min="10"
                max="300"
                step="10"
                value={config.timeout || 60}
                onChange={(e) =>
                  setConfig({ ...config, timeout: parseInt(e.target.value, 10) || 60 })
                }
                className="w-full text-xs font-mono bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-[10px] text-slate-500">로컬 런타임 추론 대기 시간 (초)</p>
            </div>
          </div>

          {/* 4. API Key (Optional) */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-700 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-indigo-600" />
              API Key (선택 사항)
            </label>
            <input
              type="password"
              value={config.api_key || ''}
              onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
              placeholder="로컬 구동 시 비워두셔도 됩니다 (sk-...)"
              className="w-full font-mono text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-[11px] text-slate-500">
              Ollama, LM Studio 등 로컬 런타임은 비워두셔도 정상 작동합니다.
            </p>
          </div>

          {/* 5. System Prompt Editor */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-bold text-slate-700 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-indigo-600" />
                텍스트 정제 시스템 프롬프트 (System Prompt)
              </label>
              <button
                type="button"
                onClick={handleRestoreDefaultPrompt}
                className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1 cursor-pointer hover:underline"
              >
                <RotateCcw className="w-3 h-3" />
                <span>기본 권장 프롬프트로 복원</span>
              </button>
            </div>
            <textarea
              rows={8}
              value={config.system_prompt}
              onChange={(e) => setConfig({ ...config, system_prompt: e.target.value })}
              className="w-full font-sans text-xs p-3 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 leading-relaxed text-slate-800"
              placeholder="시스템 프롬프트를 입력하세요..."
            />
            <p className="text-[11px] text-slate-400">
              규칙: 원문 100% 보존, 단어 중간 개행 병합, 국립국어원 표준 띄어쓰기, 표 서식 보존
            </p>
          </div>

          {/* Connection Test Result Card */}
          {testResult && (
            <div
              className={`p-3.5 rounded-xl border flex items-start gap-2.5 ${
                testResult.success
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold">
                    {testResult.success ? '연결 성공' : '연결 실패'}
                  </span>
                  {testResult.latency_ms !== undefined && (
                    <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-white/80 border border-emerald-300 font-semibold">
                      {testResult.latency_ms} ms
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px]">{testResult.message}</p>
                {testResult.error && (
                  <p className="mt-1 text-[10px] font-mono text-rose-700 break-all">
                    {testResult.error}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-between">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={isTesting || isLoading}
            className="px-3.5 py-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-800 rounded-xl transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-2xs"
          >
            {isTesting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600 dark:text-indigo-400" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
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
