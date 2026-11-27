import React, { useEffect, useRef, useState } from 'react';
import {
  FileAudio,
  Loader2,
  Mic,
  Pause,
  Play,
  Square,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import { formatFileSize, formatTimestampDisplay } from '../utils/exportFormats';

interface AudioRecorderAndDropzoneProps {
  selectedFile: File | null;
  audioUrl: string | null;
  durationSeconds: number;
  isTranscribing: boolean;
  isGeneratingSample: boolean;
  audioElementRef: React.RefObject<HTMLAudioElement | null>;
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
  onSelectFile: (file: File, duration: number) => void;
  onClearFile: () => void;
  onGenerateSample: (preset: 'standup' | 'multilingual' | 'keynote', customText?: string) => void;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onChangePlaybackRate: (rate: number) => void;
}

const MAX_BYTES = 20 * 1024 * 1024;

export function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
      URL.revokeObjectURL(url);
      resolve(dur);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    audio.src = url;
  });
}

export function AudioRecorderAndDropzone({
  selectedFile,
  audioUrl,
  durationSeconds,
  isTranscribing,
  isGeneratingSample,
  audioElementRef,
  currentTime,
  isPlaying,
  playbackRate,
  onSelectFile,
  onClearFile,
  onGenerateSample,
  onTogglePlay,
  onSeek,
  onChangePlaybackRate,
}: AudioRecorderAndDropzoneProps) {
  const [inputMode, setInputMode] = useState<'upload' | 'record' | 'sample'>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);

  // Sample synthesis state
  const [customSampleText, setCustomSampleText] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const recordingStartRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      stopVisualizerAndStream();
    };
  }, []);

  const stopVisualizerAndStream = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const drawWaveform = () => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const renderFrame = () => {
      animFrameRef.current = requestAnimationFrame(renderFrame);
      analyser.getByteFrequencyData(dataArray);

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const barCount = 48;
      const step = Math.max(1, Math.floor(bufferLength / barCount));
      const gap = 3;
      const barWidth = (width - gap * (barCount - 1)) / barCount;

      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step] || 0;
        const normalized = Math.max(0.08, value / 255);
        const barHeight = Math.round(normalized * (height - 8));
        const x = i * (barWidth + gap);
        const y = (height - barHeight) / 2;
        ctx.fillStyle = isPaused ? '#94A3B8' : '#2563EB';
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }
    };
    renderFrame();
  };

  const startRecording = async () => {
    setMicError(null);
    setFileError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const recordedFile = new File([blob], `mic_recording_${Date.now()}.webm`, {
          type: 'audio/webm',
        });
        const measuredDuration =
          (await readAudioDuration(recordedFile)) || recordingSeconds;
        stopVisualizerAndStream();
        setIsRecording(false);
        setIsPaused(false);
        onSelectFile(recordedFile, measuredDuration);
      };

      recorder.start(250);
      recordingStartRef.current = Date.now();
      setRecordingSeconds(0);
      setIsRecording(true);
      setIsPaused(false);

      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 0.1);
      }, 100);

      requestAnimationFrame(drawWaveform);
    } catch (err) {
      setMicError(
        err instanceof Error
          ? err.message
          : 'Microphone access was denied or is unavailable.'
      );
      stopVisualizerAndStream();
    }
  };

  const togglePauseRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'recording') {
      recorder.pause();
      setIsPaused(true);
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    } else if (recorder.state === 'paused') {
      recorder.resume();
      setIsPaused(false);
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 0.1);
      }, 100);
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  };

  const handleIncomingFile = async (file: File) => {
    setFileError(null);
    if (file.size === 0) {
      setFileError('Selected audio file is empty.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setFileError(`File exceeds the 20 MB limit (${formatFileSize(file.size)}).`);
      return;
    }
    const dur = await readAudioDuration(file);
    onSelectFile(file, dur);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Audio Source</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Upload a file, capture microphone audio, or synthesize a spoken test clip.
          </p>
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setInputMode('upload')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              inputMode === 'upload'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Upload File
          </button>
          <button
            type="button"
            onClick={() => setInputMode('record')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              inputMode === 'record'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Live Microphone
          </button>
          <button
            type="button"
            onClick={() => setInputMode('sample')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              inputMode === 'sample'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Test Samples
          </button>
        </div>
      </div>

      <div className="mt-4">
        {inputMode === 'upload' && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) void handleIncomingFile(dropped);
            }}
            onClick={() => !isTranscribing && fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !isTranscribing) {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            className={`border border-dashed rounded-lg px-6 py-7 text-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
              isDragging
                ? 'border-blue-600 bg-blue-50/60'
                : 'border-slate-300 hover:border-slate-400 bg-slate-50/50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.webm,.m4a,.ogg,.flac,.aac"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleIncomingFile(f);
                e.target.value = '';
              }}
            />
            <div className="mx-auto w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-700 mb-3">
              <Upload className="w-5 h-5" />
            </div>
            <p className="text-sm font-medium text-slate-900">
              Drop audio file here or click to browse
            </p>
            <p className="text-xs text-slate-500 mt-1">
              MP3, WAV, WebM, M4A, OGG, FLAC, or AAC · Up to 20 MB
            </p>
          </div>
        )}

        {inputMode === 'record' && (
          <div className="border border-slate-200 rounded-lg p-5 bg-slate-50/50">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center border ${
                    isRecording && !isPaused
                      ? 'bg-red-50 border-red-200 text-red-600'
                      : 'bg-white border-slate-200 text-slate-700'
                  }`}
                >
                  <Mic className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">
                      {isRecording
                        ? isPaused
                          ? 'Recording paused'
                          : 'Capturing microphone audio'
                        : 'Ready to record'}
                    </span>
                    {isRecording && !isPaused && (
                      <span
                        className="w-2 h-2 rounded-full bg-red-600 animate-pulse"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <p className="text-xs font-mono tabular-nums text-slate-500 mt-0.5">
                    {formatTimestampDisplay(recordingSeconds)} · WebM Opus
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!isRecording ? (
                  <button
                    type="button"
                    onClick={startRecording}
                    disabled={isTranscribing}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Mic className="w-4 h-4" />
                    Start Recording
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={togglePauseRecording}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                      {isPaused ? 'Resume' : 'Pause'}
                    </button>
                    <button
                      type="button"
                      onClick={stopRecording}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Square className="w-3.5 h-3.5" />
                      Stop & Load
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="mt-4 bg-white border border-slate-200 rounded-md p-2 h-16 flex items-center justify-center overflow-hidden">
              {isRecording ? (
                <canvas
                  ref={canvasRef}
                  width={560}
                  height={48}
                  className="w-full h-12"
                />
              ) : (
                <p className="text-xs text-slate-400">
                  Live frequency bars appear here while recording
                </p>
              )}
            </div>

            {micError && (
              <p className="mt-2.5 text-xs text-red-600">{micError}</p>
            )}
          </div>
        )}

        {inputMode === 'sample' && (
          <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                disabled={isGeneratingSample || isTranscribing}
                onClick={() => onGenerateSample('standup')}
                className="text-left p-3 rounded-lg bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50/30 transition-colors cursor-pointer disabled:opacity-50"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900">Engineering Standup</span>
                  <Volume2 className="w-3.5 h-3.5 text-slate-500" />
                </div>
                <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                  English sprint update with technical terms and action items.
                </p>
              </button>

              <button
                type="button"
                disabled={isGeneratingSample || isTranscribing}
                onClick={() => onGenerateSample('multilingual')}
                className="text-left p-3 rounded-lg bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50/30 transition-colors cursor-pointer disabled:opacity-50"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900">Spanish Support Call</span>
                  <Volume2 className="w-3.5 h-3.5 text-slate-500" />
                </div>
                <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                  Spanish audio clip ideal for testing auto-detect and translation.
                </p>
              </button>

              <button
                type="button"
                disabled={isGeneratingSample || isTranscribing}
                onClick={() => onGenerateSample('keynote')}
                className="text-left p-3 rounded-lg bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50/30 transition-colors cursor-pointer disabled:opacity-50"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900">Product Keynote</span>
                  <Volume2 className="w-3.5 h-3.5 text-slate-500" />
                </div>
                <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                  Clear narrative speech for subtitle timing and formatting.
                </p>
              </button>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={customSampleText}
                onChange={(e) => setCustomSampleText(e.target.value)}
                placeholder="Or type any phrase to synthesize a custom WAV test clip..."
                className="flex-1 min-w-0 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <button
                type="button"
                disabled={!customSampleText.trim() || isGeneratingSample || isTranscribing}
                onClick={() => onGenerateSample('standup', customSampleText)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isGeneratingSample ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Synthesizing
                  </>
                ) : (
                  'Generate WAV'
                )}
              </button>
            </div>
          </div>
        )}

        {fileError && (
          <p className="mt-2.5 text-xs text-red-600 font-medium">{fileError}</p>
        )}
      </div>

      {selectedFile && audioUrl && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                <FileAudio className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-slate-500 font-mono tabular-nums">
                  {formatFileSize(selectedFile.size)}
                  <span aria-hidden="true"> · </span>
                  {formatTimestampDisplay(durationSeconds)}
                  <span aria-hidden="true"> · </span>
                  {selectedFile.type || 'audio'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="inline-flex items-center border border-slate-200 rounded-lg bg-white overflow-hidden">
                {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => onChangePlaybackRate(rate)}
                    className={`px-2 py-1 text-xs font-mono tabular-nums transition-colors cursor-pointer ${
                      playbackRate === rate
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={onClearFile}
                aria-label="Remove audio file"
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={onTogglePlay}
              aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
              className="w-8 h-8 rounded-lg bg-slate-900 text-white hover:bg-slate-800 flex items-center justify-center shrink-0 transition-colors cursor-pointer"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>
            <span className="text-xs font-mono tabular-nums text-slate-600 w-14 shrink-0">
              {formatTimestampDisplay(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(durationSeconds, 0.1)}
              step={0.1}
              value={Math.min(currentTime, Math.max(durationSeconds, 0.1))}
              onChange={(e) => onSeek(Number(e.target.value))}
              aria-label="Audio playback position"
              className="flex-1 accent-blue-600 cursor-pointer"
            />
            <span className="text-xs font-mono tabular-nums text-slate-500 w-14 text-right shrink-0">
              {formatTimestampDisplay(durationSeconds)}
            </span>
          </div>

          <audio ref={audioElementRef} src={audioUrl} className="hidden" />
        </div>
      )}
    </div>
  );
}
