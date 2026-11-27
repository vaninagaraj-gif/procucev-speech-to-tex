import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Languages,
  ListChecks,
  Loader2,
  Pencil,
  Search,
} from 'lucide-react';
import type { TranscriptInsights, TranscriptionRecord } from '../types/speech';
import {
  buildMarkdown,
  buildSrt,
  buildVtt,
  downloadTextFile,
  formatTimestampDisplay,
} from '../utils/exportFormats';

interface TranscriptWorkbenchProps {
  record: TranscriptionRecord | null;
  isTranscribing: boolean;
  currentTime: number;
  onSeekAudio: (seconds: number) => void;
  onUpdateRecord: (updated: TranscriptionRecord) => void;
}

const TRANSLATION_LANGUAGES = [
  'English',
  'Spanish',
  'French',
  'German',
  'Japanese',
  'Hindi',
  'Portuguese',
  'Mandarin Chinese',
  'Korean',
  'Arabic',
  'Italian',
];

export function TranscriptWorkbench({
  record,
  isTranscribing,
  currentTime,
  onSeekAudio,
  onUpdateRecord,
}: TranscriptWorkbenchProps) {
  const [activeTab, setActiveTab] = useState<'segments' | 'full' | 'insights' | 'translate'>('segments');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [speakerDraft, setSpeakerDraft] = useState('');
  const [editingSegmentId, setEditingSegmentId] = useState<number | null>(null);
  const [segmentDraft, setSegmentDraft] = useState('');

  // Insights & Translation API state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [targetLang, setTargetLang] = useState('Spanish');
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  const wordCount = useMemo(() => {
    if (!record?.text) return 0;
    return record.text.split(/\s+/).filter(Boolean).length;
  }, [record?.text]);

  const filteredSegments = useMemo(() => {
    if (!record) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return record.segments;
    return record.segments.filter((seg) => {
      const speaker = record.speakerAliases?.[seg.speaker] || seg.speaker;
      return (
        seg.text.toLowerCase().includes(q) ||
        speaker.toLowerCase().includes(q) ||
        (seg.translatedText && seg.translatedText.toLowerCase().includes(q))
      );
    });
  }, [record, searchQuery]);

  const handleCopy = async (label: string, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedType(label);
    setTimeout(() => setCopiedType(null), 1800);
  };

  const handleSaveSpeaker = (originalSpeaker: string) => {
    if (!record) return;
    const trimmed = speakerDraft.trim();
    if (trimmed) {
      onUpdateRecord({
        ...record,
        speakerAliases: {
          ...(record.speakerAliases || {}),
          [originalSpeaker]: trimmed,
        },
      });
    }
    setEditingSpeaker(null);
  };

  const handleSaveSegmentText = (segId: number) => {
    if (!record) return;
    const updatedSegments = record.segments.map((s) =>
      s.id === segId ? { ...s, text: segmentDraft.trim() || s.text } : s
    );
    const updatedText = updatedSegments.map((s) => s.text).join(' ');
    onUpdateRecord({
      ...record,
      segments: updatedSegments,
      text: updatedText,
    });
    setEditingSegmentId(null);
  };

  const handleRunInsights = async () => {
    if (!record) return;
    setIsAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: record.text, mode: 'insights' }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Could not analyze transcript.');
      }
      onUpdateRecord({
        ...record,
        insights: data as TranscriptInsights,
      });
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : 'Analysis failed.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRunTranslation = async () => {
    if (!record) return;
    setIsTranslating(true);
    setTranslateError(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: record.text,
          mode: 'translate',
          targetLanguage: targetLang,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Translation failed.');
      }
      onUpdateRecord({
        ...record,
        translatedText: data.translatedText,
      });
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : 'Translation failed.');
    } finally {
      setIsTranslating(false);
    }
  };

  if (isTranscribing) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Transcribing and aligning audio segments
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Detecting spoken language, speaker turns, and timestamps
            </p>
          </div>
        </div>
        <div className="space-y-3 pt-2">
          {[1, 2, 3].map((row) => (
            <div key={row} className="h-14 rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <h3 className="text-base font-semibold text-slate-900">
          No active transcript yet
        </h3>
        <p className="text-sm text-slate-500 max-w-md mx-auto mt-1.5">
          Load an audio file, record from your microphone, or synthesize a spoken test sample above, then run transcription to inspect timestamped segments, speaker turns, and exports.
        </p>
      </div>
    );
  }

  const baseFilename = record.filename.replace(/\.[^.]+$/, '');

  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      {/* Header & Metadata */}
      <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Transcript Output</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1 font-mono tabular-nums">
            <span className="font-sans font-medium text-slate-700">
              {record.language} ({record.languageCode})
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatTimestampDisplay(record.durationSeconds)}</span>
            <span aria-hidden="true">·</span>
            <span>{wordCount} words</span>
            <span aria-hidden="true">·</span>
            <span>{record.segments.length} segments</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleCopy('text', record.text)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copiedType === 'text' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedType === 'text' ? 'Copied' : 'Copy Text'}
          </button>

          <button
            type="button"
            onClick={() => downloadTextFile(`${baseFilename}.srt`, buildSrt(record))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            SRT
          </button>

          <button
            type="button"
            onClick={() => downloadTextFile(`${baseFilename}.vtt`, buildVtt(record), 'text/vtt;charset=utf-8')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            VTT
          </button>

          <button
            type="button"
            onClick={() =>
              downloadTextFile(
                `${baseFilename}.json`,
                JSON.stringify(record, null, 2),
                'application/json;charset=utf-8'
              )
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            JSON
          </button>

          <button
            type="button"
            onClick={() =>
              downloadTextFile(`${baseFilename}.md`, buildMarkdown(record), 'text/markdown;charset=utf-8')
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Markdown
          </button>
        </div>
      </div>

      {/* Sub-navigation tabs & Search */}
      <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-200/60 rounded-lg">
          {[
            { id: 'segments', label: 'Timestamped Segments' },
            { id: 'full', label: 'Full Transcript' },
            { id: 'insights', label: 'Summary & Actions' },
            { id: 'translate', label: 'Translate' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'segments' && (
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter transcript..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        )}
      </div>

      {/* Tab Body */}
      <div className="p-5">
        {activeTab === 'segments' && (
          <div className="divide-y divide-slate-100">
            {filteredSegments.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">
                No segments match "{searchQuery}".
              </p>
            ) : (
              filteredSegments.map((seg) => {
                const isActive =
                  currentTime >= seg.start && currentTime <= seg.end && currentTime > 0;
                const displaySpeaker = record.speakerAliases?.[seg.speaker] || seg.speaker;
                return (
                  <div
                    key={seg.id}
                    className={`py-3.5 px-3 -mx-3 rounded-lg transition-colors flex flex-col sm:flex-row sm:items-start gap-3 ${
                      isActive ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex sm:flex-col items-center sm:items-start gap-2 sm:gap-1 w-full sm:w-36 shrink-0">
                      <button
                        type="button"
                        onClick={() => onSeekAudio(seg.start)}
                        title="Jump audio to this segment"
                        className="text-xs font-mono tabular-nums text-blue-700 hover:text-blue-900 hover:underline cursor-pointer"
                      >
                        {formatTimestampDisplay(seg.start)} – {formatTimestampDisplay(seg.end)}
                      </button>

                      {editingSpeaker === seg.speaker ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={speakerDraft}
                            onChange={(e) => setSpeakerDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveSpeaker(seg.speaker);
                              if (e.key === 'Escape') setEditingSpeaker(null);
                            }}
                            autoFocus
                            className="w-24 px-1.5 py-0.5 text-xs border border-blue-400 rounded bg-white text-slate-900 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveSpeaker(seg.speaker)}
                            className="text-xs text-blue-700 font-medium cursor-pointer"
                          >
                            Save
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSpeaker(seg.speaker);
                            setSpeakerDraft(displaySpeaker);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                        >
                          <span>{displaySpeaker}</span>
                          <Pencil className="w-3 h-3 text-slate-400" />
                        </button>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      {editingSegmentId === seg.id ? (
                        <div className="space-y-2">
                          <textarea
                            value={segmentDraft}
                            onChange={(e) => setSegmentDraft(e.target.value)}
                            rows={2}
                            className="w-full px-3 py-2 text-sm border border-blue-400 rounded-lg bg-white text-slate-900 focus:outline-none"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleSaveSegmentText(seg.id)}
                              className="px-3 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
                            >
                              Save Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingSegmentId(null)}
                              className="px-3 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="group flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm text-slate-900 leading-relaxed">{seg.text}</p>
                            {seg.translatedText && (
                              <p className="text-xs text-slate-600 mt-1.5 italic">
                                {seg.translatedText}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingSegmentId(seg.id);
                              setSegmentDraft(seg.text);
                            }}
                            aria-label="Edit segment text"
                            className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-slate-700 transition-opacity cursor-pointer shrink-0"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === 'full' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-800 leading-7 whitespace-pre-wrap max-w-[75ch]">
              {record.text}
            </p>
            {record.translatedText && (
              <div className="pt-4 border-t border-slate-100">
                <h4 className="text-xs font-semibold text-slate-500 mb-2">
                  Translated Output
                </h4>
                <p className="text-sm text-slate-800 leading-7 whitespace-pre-wrap max-w-[75ch]">
                  {record.translatedText}
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'insights' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Post-Transcription Intelligence
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Extract an executive summary, key topics, and action items from this audio.
                </p>
              </div>
              <button
                type="button"
                onClick={handleRunInsights}
                disabled={isAnalyzing}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Analyzing
                  </>
                ) : (
                  <>
                    <ListChecks className="w-3.5 h-3.5" />
                    {record.insights ? 'Refresh Insights' : 'Extract Insights'}
                  </>
                )}
              </button>
            </div>

            {analyzeError && (
              <p className="text-xs text-red-600">{analyzeError}</p>
            )}

            {record.insights ? (
              <div className="space-y-5 pt-2 border-t border-slate-100">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-1.5">
                    <span className="font-semibold text-slate-700">Executive Summary</span>
                    <span aria-hidden="true">·</span>
                    <span>Tone: {record.insights.tone}</span>
                  </div>
                  <p className="text-sm text-slate-800 leading-relaxed max-w-[75ch]">
                    {record.insights.summary}
                  </p>
                </div>

                {record.insights.topics.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-700 mb-1.5">Key Topics</h4>
                    <p className="text-sm text-slate-600">
                      {record.insights.topics.join(' · ')}
                    </p>
                  </div>
                )}

                <div>
                  <h4 className="text-xs font-semibold text-slate-700 mb-2">Action Items</h4>
                  {record.insights.actionItems.length === 0 ? (
                    <p className="text-xs text-slate-500">No concrete action items detected.</p>
                  ) : (
                    <ul className="space-y-2">
                      {record.insights.actionItems.map((item, idx) => (
                        <li key={idx} className="flex items-start gap-2.5 text-sm text-slate-800">
                          <input
                            type="checkbox"
                            className="mt-1 rounded border-slate-300 accent-blue-600 cursor-pointer"
                          />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <div className="py-6 text-center border border-dashed border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500">
                  Click Extract Insights to generate summary notes and action items.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'translate' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Translate Transcript
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Convert the verbatim transcript into any target language.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value)}
                  aria-label="Target translation language"
                  className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {TRANSLATION_LANGUAGES.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleRunTranslation}
                  disabled={isTranslating}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isTranslating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Translating
                    </>
                  ) : (
                    <>
                      <Languages className="w-3.5 h-3.5" />
                      Translate
                    </>
                  )}
                </button>
              </div>
            </div>

            {translateError && (
              <p className="text-xs text-red-600">{translateError}</p>
            )}

            {record.translatedText ? (
              <div className="pt-4 border-t border-slate-100 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">
                    Translated Output
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy('translated', record.translatedText || '')}
                    className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    {copiedType === 'translated' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    {copiedType === 'translated' ? 'Copied' : 'Copy Translation'}
                  </button>
                </div>
                <p className="text-sm text-slate-800 leading-7 whitespace-pre-wrap max-w-[75ch]">
                  {record.translatedText}
                </p>
              </div>
            ) : (
              <div className="py-6 text-center border border-dashed border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500">
                  Select a target language and click Translate.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
