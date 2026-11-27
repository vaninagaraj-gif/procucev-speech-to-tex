import React, { useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FilePlus2,
  Loader2,
  Play,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { BatchQueueItem, TranscriptionOptions, TranscriptionRecord } from '../types/speech';
import { readAudioDuration } from './AudioRecorderAndDropzone';
import { downloadTextFile, formatFileSize, formatTimestampDisplay } from '../utils/exportFormats';

interface BatchQueueViewProps {
  options: TranscriptionOptions;
  queue: BatchQueueItem[];
  onAddFiles: (items: BatchQueueItem[]) => void;
  onUpdateItem: (id: string, patch: Partial<BatchQueueItem>) => void;
  onRemoveItem: (id: string) => void;
  onClearCompleted: () => void;
  onOpenResult: (record: TranscriptionRecord) => void;
  onRecordCreated: (record: TranscriptionRecord) => void;
}

const MAX_BYTES = 20 * 1024 * 1024;

export function BatchQueueView({
  options,
  queue,
  onAddFiles,
  onUpdateItem,
  onRemoveItem,
  onClearCompleted,
  onOpenResult,
  onRecordCreated,
}: BatchQueueViewProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const newItems: BatchQueueItem[] = [];
    for (const file of Array.from(fileList)) {
      const durationSeconds = await readAudioDuration(file);
      const isOversized = file.size > MAX_BYTES || file.size === 0;
      newItems.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        file,
        filename: file.name,
        fileSizeBytes: file.size,
        durationSeconds,
        status: isOversized ? 'error' : 'queued',
        error:
          file.size === 0
            ? 'Empty file'
            : file.size > MAX_BYTES
            ? 'Exceeds 20 MB limit'
            : undefined,
      });
    }
    onAddFiles(newItems);
  };

  const runBatch = async () => {
    const queuedItems = queue.filter((item) => item.status === 'queued');
    if (queuedItems.length === 0 || isRunning) return;
    setIsRunning(true);

    for (const item of queuedItems) {
      onUpdateItem(item.id, { status: 'processing', error: undefined });
      try {
        const formData = new FormData();
        formData.append('file', item.file);
        formData.append('task', options.task);
        formData.append('language', options.language);
        formData.append('targetLanguage', options.targetLanguage);
        formData.append('initialPrompt', options.initialPrompt);
        formData.append('includeTimestamps', String(options.includeTimestamps));
        formData.append('diarize', String(options.diarize));
        formData.append('durationSeconds', String(item.durationSeconds));

        const res = await fetch('/api/transcribe', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || 'Transcription failed');
        }

        const record: TranscriptionRecord = {
          id: item.id,
          filename: item.filename,
          fileSizeBytes: item.fileSizeBytes,
          mimeType: item.file.type || 'audio/webm',
          createdAt: new Date().toISOString(),
          durationSeconds: item.durationSeconds || data.durationSeconds || 0,
          language: data.language,
          languageCode: data.languageCode,
          task: options.task,
          text: data.text,
          translatedText: data.translatedText || '',
          segments: data.segments || [],
        };

        onUpdateItem(item.id, { status: 'completed', result: record });
        onRecordCreated(record);
      } catch (err) {
        onUpdateItem(item.id, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Batch error',
        });
      }
    }
    setIsRunning(false);
  };

  const completedResults = queue
    .filter((q) => q.status === 'completed' && q.result)
    .map((q) => q.result!);

  const queuedCount = queue.filter((q) => q.status === 'queued').length;

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Batch Audio Queue</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Queue multiple recordings (up to 20 MB each) and transcribe them with your active pipeline settings.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="audio/*,.mp3,.wav,.webm,.m4a,.ogg,.flac,.aac"
            className="hidden"
            onChange={(e) => {
              void handleFilesSelected(e.target.files);
              e.target.value = '';
            }}
          />

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FilePlus2 className="w-3.5 h-3.5" />
            Add Audio Files
          </button>

          {completedResults.length > 0 && (
            <>
              <button
                type="button"
                onClick={() =>
                  downloadTextFile(
                    `batch_transcripts_${Date.now()}.json`,
                    JSON.stringify(completedResults, null, 2),
                    'application/json;charset=utf-8'
                  )
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Export All JSON
              </button>
              <button
                type="button"
                onClick={onClearCompleted}
                className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Clear Completed
              </button>
            </>
          )}

          <button
            type="button"
            onClick={runBatch}
            disabled={queuedCount === 0 || isRunning}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Processing Queue
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                Run Queue ({queuedCount})
              </>
            )}
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {queue.length === 0 ? (
          <div className="p-10 text-center">
            <h3 className="text-sm font-semibold text-slate-900">Queue is empty</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              Add two or more audio files to process interviews, meetings, or support recordings sequentially.
            </p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              <FilePlus2 className="w-3.5 h-3.5" />
              Select Audio Files
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Filename</th>
                  <th className="py-2.5 px-4 text-right">Size</th>
                  <th className="py-2.5 px-4 text-right">Duration</th>
                  <th className="py-2.5 px-4">Language</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {queue.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 px-4 font-medium text-slate-900 max-w-xs truncate">
                      {item.filename}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-xs text-slate-600">
                      {formatFileSize(item.fileSizeBytes)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-xs text-slate-600">
                      {formatTimestampDisplay(item.durationSeconds)}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600">
                      {item.result ? `${item.result.language} (${item.result.languageCode})` : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-xs">
                      {item.status === 'queued' && (
                        <span className="text-slate-600">Queued</span>
                      )}
                      {item.status === 'processing' && (
                        <span className="inline-flex items-center gap-1.5 text-blue-700 font-medium">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Transcribing
                        </span>
                      )}
                      {item.status === 'completed' && (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Completed
                        </span>
                      )}
                      {item.status === 'error' && (
                        <span
                          className="inline-flex items-center gap-1.5 text-red-600 font-medium"
                          title={item.error}
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          {item.error || 'Error'}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        {item.result && (
                          <button
                            type="button"
                            onClick={() => onOpenResult(item.result!)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 cursor-pointer"
                          >
                            Open
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onRemoveItem(item.id)}
                          disabled={item.status === 'processing'}
                          aria-label={`Remove ${item.filename}`}
                          className="p-1 text-slate-400 hover:text-red-600 disabled:opacity-40 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
