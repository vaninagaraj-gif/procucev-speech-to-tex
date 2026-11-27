export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  speaker: string;
  text: string;
  translatedText?: string;
}

export interface TranscriptInsights {
  summary: string;
  tone: string;
  topics: string[];
  actionItems: string[];
}

export interface TranscriptionOptions {
  task: 'transcribe' | 'translate';
  language: string;
  targetLanguage: string;
  initialPrompt: string;
  includeTimestamps: boolean;
  diarize: boolean;
  beamSize: number;
  vadFilter: boolean;
}

export interface TranscriptionRecord {
  id: string;
  filename: string;
  fileSizeBytes: number;
  mimeType: string;
  createdAt: string;
  durationSeconds: number;
  language: string;
  languageCode: string;
  task: 'transcribe' | 'translate';
  text: string;
  translatedText?: string;
  segments: TranscriptSegment[];
  insights?: TranscriptInsights;
  speakerAliases?: Record<string, string>;
}

export interface BatchQueueItem {
  id: string;
  file: File;
  filename: string;
  fileSizeBytes: number;
  durationSeconds: number;
  status: 'queued' | 'processing' | 'completed' | 'error';
  error?: string;
  result?: TranscriptionRecord;
}

export interface PythonFeatureFlags {
  timestampsAndWords: boolean;
  taskAndLanguageParams: boolean;
  srtVttExport: boolean;
  customVocabAndVad: boolean;
  batchEndpoint: boolean;
  sseStreaming: boolean;
  urlIngestion: boolean;
  authAndCors: boolean;
}
