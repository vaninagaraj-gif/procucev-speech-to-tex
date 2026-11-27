import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Code2,
  History,
  Layers,
  Loader2,
  Menu,
  Mic,
  Play,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { AudioRecorderAndDropzone } from './components/AudioRecorderAndDropzone';
import { TranscriptWorkbench } from './components/TranscriptWorkbench';
import { BatchQueueView } from './components/BatchQueueView';
import { PythonUpgradeBuilder } from './components/PythonUpgradeBuilder';
import { HistoryLibraryView } from './components/HistoryLibraryView';
import type {
  BatchQueueItem,
  TranscriptionOptions,
  TranscriptionRecord,
} from './types/speech';

type NavView = 'workbench' | 'batch' | 'python' | 'history';

const HISTORY_STORAGE_KEY = 'whispercraft_history_v1';

const DEFAULT_OPTIONS: TranscriptionOptions = {
  task: 'transcribe',
  language: 'auto',
  targetLanguage: 'English',
  initialPrompt: '',
  includeTimestamps: true,
  diarize: true,
  beamSize: 5,
  vadFilter: true,
};

const SPOKEN_LANGUAGE_OPTIONS = [
  { value: 'auto', label: 'Auto-detect language' },
  { value: 'en', label: 'English (en)' },
  { value: 'es', label: 'Spanish (es)' },
  { value: 'fr', label: 'French (fr)' },
  { value: 'de', label: 'German (de)' },
  { value: 'ja', label: 'Japanese (ja)' },
  { value: 'hi', label: 'Hindi (hi)' },
  { value: 'pt', label: 'Portuguese (pt)' },
  { value: 'zh', label: 'Chinese (zh)' },
  { value: 'ko', label: 'Korean (ko)' },
  { value: 'ar', label: 'Arabic (ar)' },
];

const TARGET_LANGUAGES = [
  'English',
  'Spanish',
  'French',
  'German',
  'Japanese',
  'Hindi',
  'Portuguese',
  'Mandarin Chinese',
];

function base64ToWavFile(base64: string, filename: string, mimeType: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], filename, { type: mimeType });
}

export default function App() {
  const [activeView, setActiveView] = useState<NavView>('workbench');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Pipeline configuration
  const [options, setOptions] = useState<TranscriptionOptions>(DEFAULT_OPTIONS);

  // Active audio file & player state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Transcription & sample generation state
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isGeneratingSample, setIsGeneratingSample] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeRecord, setActiveRecord] = useState<TranscriptionRecord | null>(null);

  // Batch queue & saved history
  const [batchQueue, setBatchQueue] = useState<BatchQueueItem[]>([]);
  const [history, setHistory] = useState<TranscriptionRecord[]>(() => {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as TranscriptionRecord[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, 50)));
    } catch {
      // Ignore storage quota errors
    }
  }, [history]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => setIsPlaying(false);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onLoaded = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDurationSeconds(audio.duration);
      }
      audio.playbackRate = playbackRate;
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('loadedmetadata', onLoaded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('loadedmetadata', onLoaded);
    };
  }, [audioUrl, playbackRate]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const handleSelectFile = (file: File, measuredDuration: number) => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const nextUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setAudioUrl(nextUrl);
    setDurationSeconds(measuredDuration);
    setCurrentTime(0);
    setIsPlaying(false);
    setErrorMessage(null);
  };

  const handleClearFile = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setSelectedFile(null);
    setAudioUrl(null);
    setDurationSeconds(0);
    setCurrentTime(0);
    setIsPlaying(false);
  };

  const handleTogglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  };

  const handleSeek = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setCurrentTime(seconds);
    if (audio.paused) {
      audio.play().catch(() => {});
    }
  };

  const handleChangePlaybackRate = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  const saveRecordToHistory = (record: TranscriptionRecord) => {
    setHistory((prev) => [record, ...prev.filter((item) => item.id !== record.id)]);
  };

  const handleUpdateRecord = (updated: TranscriptionRecord) => {
    setActiveRecord(updated);
    setHistory((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
  };

  const handleGenerateSample = async (
    preset: 'standup' | 'multilingual' | 'keynote',
    customText?: string
  ) => {
    setIsGeneratingSample(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/sample-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset, text: customText }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Could not generate sample audio.');
      }
      const wavFile = base64ToWavFile(
        data.audioBase64,
        data.filename || 'sample.wav',
        data.mimeType || 'audio/wav'
      );
      const url = URL.createObjectURL(wavFile);
      const probe = new Audio(url);
      probe.onloadedmetadata = () => {
        const dur = Number.isFinite(probe.duration) ? probe.duration : 6;
        URL.revokeObjectURL(url);
        handleSelectFile(wavFile, dur);
      };
      probe.onerror = () => {
        URL.revokeObjectURL(url);
        handleSelectFile(wavFile, 6);
      };
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Sample generation failed.');
    } finally {
      setIsGeneratingSample(false);
    }
  };

  const handleTranscribe = async () => {
    if (!selectedFile || isTranscribing) return;
    setIsTranscribing(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('task', options.task);
      formData.append('language', options.language);
      formData.append('targetLanguage', options.targetLanguage);
      formData.append('initialPrompt', options.initialPrompt);
      formData.append('includeTimestamps', String(options.includeTimestamps));
      formData.append('diarize', String(options.diarize));
      formData.append('durationSeconds', String(durationSeconds));

      const res = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Transcription failed.');
      }

      const record: TranscriptionRecord = {
        id: `rec_${Date.now()}`,
        filename: selectedFile.name,
        fileSizeBytes: selectedFile.size,
        mimeType: selectedFile.type || 'audio/webm',
        createdAt: new Date().toISOString(),
        durationSeconds: durationSeconds || data.durationSeconds || 0,
        language: data.language,
        languageCode: data.languageCode,
        task: options.task,
        text: data.text,
        translatedText: data.translatedText || '',
        segments: data.segments || [],
      };

      setActiveRecord(record);
      saveRecordToHistory(record);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not complete transcription.'
      );
    } finally {
      setIsTranscribing(false);
    }
  };

  const navItems: { id: NavView; label: string; icon: React.ReactNode }[] = [
    { id: 'workbench', label: 'Speech Workbench', icon: <Mic className="w-4 h-4" /> },
    { id: 'batch', label: 'Batch Queue', icon: <Layers className="w-4 h-4" /> },
    { id: 'python', label: 'Python Upgrade', icon: <Code2 className="w-4 h-4" /> },
    { id: 'history', label: 'History', icon: <History className="w-4 h-4" /> },
  ];

  const viewBreadcrumb =
    activeView === 'workbench'
      ? 'Workspace / Speech Workbench'
      : activeView === 'batch'
      ? 'Workspace / Batch Queue'
      : activeView === 'python'
      ? 'Workspace / Faster-Whisper Service Upgrade'
      : 'Workspace / Transcription History';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 bg-white border-r border-slate-200">
        <div className="h-14 px-5 flex items-center border-b border-slate-200">
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            WhisperCraft Studio
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1" aria-label="Primary Navigation">
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  {item.icon}
                  <span>{item.label}</span>
                </span>
                {item.id === 'batch' && batchQueue.length > 0 && (
                  <span
                    className={`text-xs font-mono tabular-nums ${
                      isActive ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    {batchQueue.length}
                  </span>
                )}
                {item.id === 'history' && history.length > 0 && (
                  <span
                    className={`text-xs font-mono tabular-nums ${
                      isActive ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    {history.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 text-xs text-slate-500 space-y-1">
          <div className="flex items-center justify-between">
            <span>Max upload</span>
            <span className="font-mono tabular-nums text-slate-700">20 MB</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Saved sessions</span>
            <span className="font-mono tabular-nums text-slate-700">{history.length}</span>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-64 max-w-[80vw] bg-white border-r border-slate-200 flex flex-col z-10">
            <div className="h-14 px-5 flex items-center justify-between border-b border-slate-200">
              <span className="font-display text-base font-bold text-slate-900">
                WhisperCraft Studio
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation"
                className="p-1.5 text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="p-3 space-y-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveView(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                    activeView === item.id
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 bg-white border-b border-slate-200 px-5 lg:px-7 flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded-md cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-sm font-medium text-slate-600 truncate">
              {viewBreadcrumb}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {activeView === 'workbench' ? (
              <button
                type="button"
                onClick={handleTranscribe}
                disabled={!selectedFile || isTranscribing}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isTranscribing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Transcribing
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    Run Transcription
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActiveView('workbench')}
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Open Workbench
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-5 lg:p-7 max-w-[1400px] w-full mx-auto space-y-5">
          {errorMessage && (
            <div
              role="alert"
              className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start justify-between gap-3 text-xs text-red-800"
            >
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                aria-label="Dismiss error"
                className="text-red-500 hover:text-red-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {activeView === 'workbench' && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
              {/* Main Audio + Transcript Column */}
              <div className="xl:col-span-8 space-y-5 min-w-0">
                <AudioRecorderAndDropzone
                  selectedFile={selectedFile}
                  audioUrl={audioUrl}
                  durationSeconds={durationSeconds}
                  isTranscribing={isTranscribing}
                  isGeneratingSample={isGeneratingSample}
                  audioElementRef={audioRef}
                  currentTime={currentTime}
                  isPlaying={isPlaying}
                  playbackRate={playbackRate}
                  onSelectFile={handleSelectFile}
                  onClearFile={handleClearFile}
                  onGenerateSample={handleGenerateSample}
                  onTogglePlay={handleTogglePlay}
                  onSeek={handleSeek}
                  onChangePlaybackRate={handleChangePlaybackRate}
                />

                <TranscriptWorkbench
                  record={activeRecord}
                  isTranscribing={isTranscribing}
                  currentTime={currentTime}
                  onSeekAudio={handleSeek}
                  onUpdateRecord={handleUpdateRecord}
                />
              </div>

              {/* Pipeline Configuration Column */}
              <aside className="xl:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-5">
                <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
                  <SlidersHorizontal className="w-4 h-4 text-slate-600" />
                  <h2 className="text-base font-semibold text-slate-900">
                    Pipeline Options
                  </h2>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Task Mode
                    </label>
                    <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                      <button
                        type="button"
                        onClick={() => setOptions((o) => ({ ...o, task: 'transcribe' }))}
                        className={`py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                          options.task === 'transcribe'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Transcribe
                      </button>
                      <button
                        type="button"
                        onClick={() => setOptions((o) => ({ ...o, task: 'translate' }))}
                        className={`py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                          options.task === 'translate'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Translate
                      </button>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="spoken-lang-select"
                      className="block text-xs font-semibold text-slate-700 mb-1.5"
                    >
                      Spoken Language Hint
                    </label>
                    <select
                      id="spoken-lang-select"
                      value={options.language}
                      onChange={(e) =>
                        setOptions((o) => ({ ...o, language: e.target.value }))
                      }
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      {SPOKEN_LANGUAGE_OPTIONS.map((lang) => (
                        <option key={lang.value} value={lang.value}>
                          {lang.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {options.task === 'translate' && (
                    <div>
                      <label
                        htmlFor="target-lang-select"
                        className="block text-xs font-semibold text-slate-700 mb-1.5"
                      >
                        Translate Output Into
                      </label>
                      <select
                        id="target-lang-select"
                        value={options.targetLanguage}
                        onChange={(e) =>
                          setOptions((o) => ({ ...o, targetLanguage: e.target.value }))
                        }
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      >
                        {TARGET_LANGUAGES.map((lang) => (
                          <option key={lang} value={lang}>
                            {lang}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="initial-prompt-input"
                      className="block text-xs font-semibold text-slate-700 mb-1.5"
                    >
                      Custom Vocabulary / Initial Prompt
                    </label>
                    <textarea
                      id="initial-prompt-input"
                      rows={3}
                      value={options.initialPrompt}
                      onChange={(e) =>
                        setOptions((o) => ({ ...o, initialPrompt: e.target.value }))
                      }
                      placeholder="Product names, technical acronyms, speaker names..."
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>

                  <div className="pt-2 border-t border-slate-100 space-y-3">
                    <label className="flex items-center justify-between gap-3 cursor-pointer">
                      <div>
                        <span className="block text-xs font-semibold text-slate-900">
                          Timestamped Segments
                        </span>
                        <span className="block text-xs text-slate-500">
                          Required for SRT/VTT subtitles and audio seeking
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        checked={options.includeTimestamps}
                        onChange={(e) =>
                          setOptions((o) => ({
                            ...o,
                            includeTimestamps: e.target.checked,
                          }))
                        }
                        className="rounded border-slate-300 accent-blue-600 cursor-pointer"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 cursor-pointer">
                      <div>
                        <span className="block text-xs font-semibold text-slate-900">
                          Speaker Diarization
                        </span>
                        <span className="block text-xs text-slate-500">
                          Separate turns across multiple speakers
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        checked={options.diarize}
                        onChange={(e) =>
                          setOptions((o) => ({ ...o, diarize: e.target.checked }))
                        }
                        className="rounded border-slate-300 accent-blue-600 cursor-pointer"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 cursor-pointer">
                      <div>
                        <span className="block text-xs font-semibold text-slate-900">
                          VAD Silence Filter
                        </span>
                        <span className="block text-xs text-slate-500">
                          Skip long dead-air gaps before decoding
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        checked={options.vadFilter}
                        onChange={(e) =>
                          setOptions((o) => ({ ...o, vadFilter: e.target.checked }))
                        }
                        className="rounded border-slate-300 accent-blue-600 cursor-pointer"
                      />
                    </label>

                    <div>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-semibold text-slate-900">Beam Size</span>
                        <span className="font-mono tabular-nums text-slate-600">
                          {options.beamSize}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={10}
                        value={options.beamSize}
                        onChange={(e) =>
                          setOptions((o) => ({ ...o, beamSize: Number(e.target.value) }))
                        }
                        aria-label="Beam size"
                        className="w-full accent-blue-600 cursor-pointer"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleTranscribe}
                    disabled={!selectedFile || isTranscribing}
                    className="w-full py-2.5 px-4 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                  >
                    {isTranscribing ? 'Transcribing Audio...' : 'Run Transcription'}
                  </button>
                </div>
              </aside>
            </div>
          )}

          {activeView === 'batch' && (
            <BatchQueueView
              options={options}
              queue={batchQueue}
              onAddFiles={(items) => setBatchQueue((prev) => [...prev, ...items])}
              onUpdateItem={(id, patch) =>
                setBatchQueue((prev) =>
                  prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
                )
              }
              onRemoveItem={(id) =>
                setBatchQueue((prev) => prev.filter((item) => item.id !== id))
              }
              onClearCompleted={() =>
                setBatchQueue((prev) => prev.filter((item) => item.status !== 'completed'))
              }
              onOpenResult={(record) => {
                setActiveRecord(record);
                setActiveView('workbench');
              }}
              onRecordCreated={saveRecordToHistory}
            />
          )}

          {activeView === 'python' && <PythonUpgradeBuilder />}

          {activeView === 'history' && (
            <HistoryLibraryView
              records={history}
              onOpenRecord={(record) => {
                setActiveRecord(record);
                setActiveView('workbench');
              }}
              onDeleteRecord={(id) =>
                setHistory((prev) => prev.filter((item) => item.id !== id))
              }
              onClearAll={() => setHistory([])}
            />
          )}
        </main>
      </div>
    </div>
  );
}
