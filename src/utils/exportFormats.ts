import type { TranscriptSegment, TranscriptionRecord } from '../types/speech';

export function formatTimestampDisplay(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

function formatSrtTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function formatVttTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function resolveSpeaker(segment: TranscriptSegment, aliases?: Record<string, string>): string {
  return aliases?.[segment.speaker] || segment.speaker;
}

export function buildSrt(record: TranscriptionRecord, useTranslation = false): string {
  return record.segments
    .map((seg, index) => {
      const content = useTranslation && seg.translatedText ? seg.translatedText : seg.text;
      const speaker = resolveSpeaker(seg, record.speakerAliases);
      const line = record.segments.some((s) => s.speaker !== 'Speaker 1')
        ? `[${speaker}] ${content}`
        : content;
      return `${index + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${line}`;
    })
    .join('\n\n');
}

export function buildVtt(record: TranscriptionRecord, useTranslation = false): string {
  const body = record.segments
    .map((seg) => {
      const content = useTranslation && seg.translatedText ? seg.translatedText : seg.text;
      const speaker = resolveSpeaker(seg, record.speakerAliases);
      const line = record.segments.some((s) => s.speaker !== 'Speaker 1')
        ? `<v ${speaker}>${content}`
        : content;
      return `${formatVttTime(seg.start)} --> ${formatVttTime(seg.end)}\n${line}`;
    })
    .join('\n\n');
  return `WEBVTT\n\n${body}`;
}

export function buildMarkdown(record: TranscriptionRecord): string {
  const lines: string[] = [
    `# Transcript: ${record.filename}`,
    '',
    `- **Language**: ${record.language} (${record.languageCode})`,
    `- **Duration**: ${formatTimestampDisplay(record.durationSeconds)}`,
    `- **Task**: ${record.task === 'translate' ? 'Translate' : 'Transcribe'}`,
    `- **Created**: ${new Date(record.createdAt).toLocaleString()}`,
    '',
  ];

  if (record.insights) {
    lines.push('## Summary', '', record.insights.summary, '');
    if (record.insights.topics.length > 0) {
      lines.push(`**Topics**: ${record.insights.topics.join(', ')}`, '');
    }
    if (record.insights.actionItems.length > 0) {
      lines.push('## Action Items', '');
      record.insights.actionItems.forEach((item) => lines.push(`- [ ] ${item}`));
      lines.push('');
    }
  }

  lines.push('## Segments', '');
  record.segments.forEach((seg) => {
    const speaker = resolveSpeaker(seg, record.speakerAliases);
    lines.push(`**[${formatTimestampDisplay(seg.start)} - ${formatTimestampDisplay(seg.end)}] ${speaker}:** ${seg.text}`);
    if (seg.translatedText) {
      lines.push(`> *Translation:* ${seg.translatedText}`);
    }
    lines.push('');
  });

  return lines.join('\n');
}

export function downloadTextFile(filename: string, content: string, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
