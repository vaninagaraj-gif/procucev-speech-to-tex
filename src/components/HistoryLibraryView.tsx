import React, { useMemo, useState } from 'react';
import { Download, ExternalLink, Search, Trash2 } from 'lucide-react';
import type { TranscriptionRecord } from '../types/speech';
import {
  buildSrt,
  downloadTextFile,
  formatFileSize,
  formatTimestampDisplay,
} from '../utils/exportFormats';

interface HistoryLibraryViewProps {
  records: TranscriptionRecord[];
  onOpenRecord: (record: TranscriptionRecord) => void;
  onDeleteRecord: (id: string) => void;
  onClearAll: () => void;
}

export function HistoryLibraryView({
  records,
  onOpenRecord,
  onDeleteRecord,
  onClearAll,
}: HistoryLibraryViewProps) {
  const [search, setSearch] = useState('');
  const [taskFilter, setTaskFilter] = useState<'all' | 'transcribe' | 'translate'>('all');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((rec) => {
      if (taskFilter !== 'all' && rec.task !== taskFilter) return false;
      if (!q) return true;
      return (
        rec.filename.toLowerCase().includes(q) ||
        rec.text.toLowerCase().includes(q) ||
        rec.language.toLowerCase().includes(q)
      );
    });
  }, [records, search, taskFilter]);

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Transcription History
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Search and re-export previous audio sessions saved in this browser.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {[
              { id: 'all', label: 'All' },
              { id: 'transcribe', label: 'Transcribe' },
              { id: 'translate', label: 'Translate' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTaskFilter(tab.id as typeof taskFilter)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  taskFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search transcripts..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          {records.length > 0 && (
            <button
              type="button"
              onClick={onClearAll}
              className="text-xs font-medium text-slate-500 hover:text-red-600 transition-colors cursor-pointer"
            >
              Clear History
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {records.length === 0 ? (
          <div className="p-10 text-center">
            <h3 className="text-sm font-semibold text-slate-900">
              No saved transcripts yet
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Completed transcriptions from the Workbench or Batch Queue appear here automatically.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No transcripts match your current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Audio File</th>
                  <th className="py-2.5 px-4">Language</th>
                  <th className="py-2.5 px-4 text-right">Duration</th>
                  <th className="py-2.5 px-4 text-right">Words</th>
                  <th className="py-2.5 px-4">Preview</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((rec) => {
                  const words = rec.text.split(/\s+/).filter(Boolean).length;
                  const baseName = rec.filename.replace(/\.[^.]+$/, '');
                  return (
                    <tr key={rec.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900 truncate max-w-[200px]">
                          {rec.filename}
                        </div>
                        <div className="text-xs text-slate-500 font-mono tabular-nums">
                          {formatFileSize(rec.fileSizeBytes)} ·{' '}
                          {new Date(rec.createdAt).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700">
                        {rec.language} ({rec.languageCode})
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-600">
                        {formatTimestampDisplay(rec.durationSeconds)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-600">
                        {words}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 max-w-md truncate">
                        {rec.text}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => onOpenRecord(rec)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 cursor-pointer"
                          >
                            Open
                            <ExternalLink className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => downloadTextFile(`${baseName}.srt`, buildSrt(rec))}
                            title="Download SRT"
                            className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteRecord(rec.id)}
                            title="Delete record"
                            className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
