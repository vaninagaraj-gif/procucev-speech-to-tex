import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, RotateCcw } from 'lucide-react';
import type { PythonFeatureFlags } from '../types/speech';
import {
  generateRequirementsTxt,
  generateUpgradedPythonCode,
} from '../utils/pythonGenerator';
import { downloadTextFile } from '../utils/exportFormats';

const DEFAULT_FLAGS: PythonFeatureFlags = {
  timestampsAndWords: true,
  taskAndLanguageParams: true,
  srtVttExport: true,
  customVocabAndVad: true,
  batchEndpoint: true,
  sseStreaming: true,
  urlIngestion: false,
  authAndCors: true,
};

interface FeatureSpec {
  key: keyof PythonFeatureFlags;
  title: string;
  description: string;
  endpointImpact: string;
}

const FEATURE_SPECS: FeatureSpec[] = [
  {
    key: 'timestampsAndWords',
    title: 'Segment & Word-Level Timestamps',
    description:
      'Returns segment start/end seconds and optional per-word probabilities via word_timestamps=True.',
    endpointImpact: 'POST /transcribe',
  },
  {
    key: 'taskAndLanguageParams',
    title: 'Translate Task & Language Override',
    description:
      'Adds form fields for task ("transcribe" or "translate" to English) and optional ISO language hint.',
    endpointImpact: 'POST /transcribe',
  },
  {
    key: 'srtVttExport',
    title: 'SRT, VTT & Plaintext Output Formats',
    description:
      'Adds ?response_format=json|srt|vtt|text query parameter with RFC-compliant subtitle timecodes.',
    endpointImpact: 'POST /transcribe',
  },
  {
    key: 'customVocabAndVad',
    title: 'Custom Vocabulary & VAD Tuning',
    description:
      'Exposes initial_prompt, beam_size, vad_filter, and min_silence_duration_ms controls.',
    endpointImpact: 'POST /transcribe',
  },
  {
    key: 'batchEndpoint',
    title: 'Semaphore-Guarded Batch Endpoint',
    description:
      'Processes up to 10 audio files concurrently while bounding worker threads via asyncio.Semaphore.',
    endpointImpact: 'POST /transcribe/batch',
  },
  {
    key: 'sseStreaming',
    title: 'Server-Sent Events (SSE) Streaming',
    description:
      'Streams decoded segments in real time as Faster-Whisper yields them instead of blocking.',
    endpointImpact: 'POST /transcribe/stream',
  },
  {
    key: 'urlIngestion',
    title: 'Safe Remote Audio URL Ingestion',
    description:
      'Fetches remote audio links with private/loopback IP blocking and redirect protection.',
    endpointImpact: 'POST /transcribe/url',
  },
  {
    key: 'authAndCors',
    title: 'API Key Guard & CORS Middleware',
    description:
      'Adds X-API-Key header dependency (when SPEECH_SERVICE_API_KEY is set) and configurable CORS.',
    endpointImpact: 'All Endpoints',
  },
];

export function PythonUpgradeBuilder() {
  const [flags, setFlags] = useState<PythonFeatureFlags>(DEFAULT_FLAGS);
  const [baselineCode, setBaselineCode] = useState<string>('');
  const [viewMode, setViewMode] = useState<'upgraded' | 'baseline' | 'requirements'>('upgraded');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/baseline-python')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.code) setBaselineCode(data.code);
      })
      .catch(() => {});
  }, []);

  const upgradedCode = useMemo(() => generateUpgradedPythonCode(flags), [flags]);
  const requirementsTxt = useMemo(() => generateRequirementsTxt(flags), [flags]);

  const activeText =
    viewMode === 'upgraded'
      ? upgradedCode
      : viewMode === 'baseline'
      ? baselineCode || '# Loading app_dcbcef35.py...'
      : requirementsTxt;

  const enabledCount = Object.values(flags).filter(Boolean).length;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(activeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const toggleFlag = (key: keyof PythonFeatureFlags) => {
    setFlags((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
      {/* Left Feature Checklist */}
      <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Faster-Whisper Feature Modules
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Extend <span className="font-mono text-slate-700">app_dcbcef35.py</span> with production endpoints and async safeguards.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFlags(DEFAULT_FLAGS)}
            className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 cursor-pointer shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
        </div>

        <div className="divide-y divide-slate-100">
          {FEATURE_SPECS.map((spec) => {
            const checked = flags[spec.key];
            return (
              <label
                key={spec.key}
                className="flex items-start gap-3 py-3 cursor-pointer hover:bg-slate-50/70 -mx-2 px-2 rounded-lg transition-colors"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleFlag(spec.key)}
                  className="mt-0.5 rounded border-slate-300 accent-blue-600 cursor-pointer"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900">
                      {spec.title}
                    </span>
                    <span className="text-[11px] font-mono text-slate-500 shrink-0">
                      {spec.endpointImpact}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    {spec.description}
                  </p>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* Right Code Preview */}
      <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setViewMode('upgraded')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'upgraded'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Upgraded app.py ({enabledCount} modules)
            </button>
            <button
              type="button"
              onClick={() => setViewMode('baseline')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'baseline'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Original app_dcbcef35.py
            </button>
            <button
              type="button"
              onClick={() => setViewMode('requirements')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'requirements'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              requirements.txt
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() =>
                downloadTextFile(
                  viewMode === 'requirements' ? 'requirements.txt' : 'app.py',
                  viewMode === 'requirements' ? requirementsTxt : upgradedCode,
                  'text/plain;charset=utf-8'
                )
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Download {viewMode === 'requirements' ? 'requirements.txt' : 'app.py'}
            </button>
          </div>
        </div>

        <div className="bg-slate-950 text-slate-100 p-4 overflow-x-auto max-h-[640px] overflow-y-auto">
          <pre className="text-xs font-mono leading-relaxed whitespace-pre">
            {activeText}
          </pre>
        </div>

        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <span>
            Run locally: <code className="font-mono text-slate-900">uvicorn app:app --host 0.0.0.0 --port 8000</code>
          </span>
          <span className="font-mono tabular-nums">
            {activeText.split('\n').length} lines
          </span>
        </div>
      </div>
    </div>
  );
}
