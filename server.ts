import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB matching app_dcbcef35.py

const ALLOWED_AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.webm',
  '.m4a',
  '.mp4',
  '.ogg',
  '.oga',
  '.flac',
  '.aac',
  '.opus',
]);

const EXTENSION_MIME_MAP: Record<string, string> = {
  '.mp3': 'audio/mp3',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.opus': 'audio/ogg',
};

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function resolveMimeType(file: Express.Multer.File): string {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (file.mimetype && file.mimetype.startsWith('audio/')) {
    if (file.mimetype === 'audio/mpeg') return 'audio/mp3';
    if (file.mimetype === 'audio/x-wav') return 'audio/wav';
    if (file.mimetype === 'audio/x-m4a') return 'audio/mp4';
    return file.mimetype;
  }
  if (file.mimetype === 'video/webm') return 'audio/webm';
  return EXTENSION_MIME_MAP[ext] || 'audio/webm';
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const isAudioMime =
      file.mimetype.startsWith('audio/') ||
      file.mimetype === 'video/webm' ||
      file.mimetype === 'application/octet-stream';
    if (!isAudioMime && !ALLOWED_AUDIO_EXTENSIONS.has(ext)) {
      cb(new Error('Unsupported audio format. Upload MP3, WAV, WebM, M4A, OGG, FLAC, or AAC.'));
      return;
    }
    if (ext && !ALLOWED_AUDIO_EXTENSIONS.has(ext)) {
      cb(new Error(`Unsupported file extension (${ext}).`));
      return;
    }
    cb(null, true);
  },
});

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Health endpoint mirroring Faster-Whisper /health contract
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'UP',
      service: 'WhisperCraft Studio',
      maxFileSizeMb: 20,
      hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  // Serve exact baseline Python file for the Upgrade Builder diff view
  app.get('/api/baseline-python', (_req: Request, res: Response) => {
    const baseDir = path.resolve(process.cwd(), 'public', 'assets', 'aistudio');
    const targetPath = path.resolve(baseDir, 'app_dcbcef35.py');
    if (!targetPath.startsWith(baseDir + path.sep)) {
      res.status(403).json({ detail: 'Access denied' });
      return;
    }
    if (!fs.existsSync(targetPath)) {
      res.status(404).json({ detail: 'Baseline Python service file not found' });
      return;
    }
    const code = fs.readFileSync(targetPath, 'utf-8');
    res.json({ filename: 'app_dcbcef35.py', code });
  });

  // Main audio transcription endpoint with timestamps, diarization, language detection & translation
  app.post('/api/transcribe', upload.single('file'), async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ detail: 'Audio file is required.' });
        return;
      }
      if (!file.buffer || file.buffer.length === 0) {
        res.status(400).json({ detail: 'Audio file is empty.' });
        return;
      }

      const task = req.body.task === 'translate' ? 'translate' : 'transcribe';
      const languageHint = typeof req.body.language === 'string' ? req.body.language.trim().slice(0, 32) : 'auto';
      const targetLanguage =
        typeof req.body.targetLanguage === 'string' && req.body.targetLanguage.trim()
          ? req.body.targetLanguage.trim().slice(0, 48)
          : 'English';
      const initialPrompt =
        typeof req.body.initialPrompt === 'string' ? req.body.initialPrompt.trim().slice(0, 500) : '';
      const includeTimestamps = req.body.includeTimestamps !== 'false';
      const diarize = req.body.diarize !== 'false';
      const durationSeconds = Math.max(0, Number(req.body.durationSeconds || 0));

      const ai = getAiClient();
      const mimeType = resolveMimeType(file);
      const base64Audio = file.buffer.toString('base64');

      const audioPart = {
        inlineData: {
          mimeType,
          data: base64Audio,
        },
      };

      // Step 1: Primary verbatim transcription using gemini-3.5-transcribe
      const transcribeDirectives = [
        'Transcribe this audio accurately and verbatim.',
        languageHint && languageHint !== 'auto'
          ? `The spoken language hint is "${languageHint}".`
          : 'Automatically detect the spoken language.',
        initialPrompt ? `Context and vocabulary hints: ${initialPrompt}` : '',
      ]
        .filter(Boolean)
        .join(' ');

      const rawResponse = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [audioPart, { text: transcribeDirectives }],
        },
      });

      const verbatimText = (rawResponse.text ?? '').trim();
      if (!verbatimText) {
        res.status(422).json({ detail: 'No intelligible speech detected in the uploaded audio.' });
        return;
      }

      // Step 2: Structured segments, timestamps, speaker diarization, language & optional translation
      const structPrompt = [
        'Analyze the provided audio and its verbatim transcript to produce structured timestamped segments.',
        `Verbatim transcript: """${verbatimText}"""`,
        durationSeconds > 0
          ? `Known audio duration in seconds: ${durationSeconds.toFixed(2)}. Ensure all segment start/end times fall within 0 and ${durationSeconds.toFixed(2)}.`
          : 'Estimate accurate start and end timestamps in seconds for each spoken phrase.',
        diarize
          ? 'Identify distinct speakers and label them consistently (e.g. "Speaker 1", "Speaker 2").'
          : 'Label all segments with "Speaker 1".',
        includeTimestamps
          ? 'Split the transcript into natural, sentence-level or phrase-level timestamped segments.'
          : 'Provide a single segment covering the transcript.',
        task === 'translate'
          ? `Also translate the full transcript and each segment cleanly into ${targetLanguage}.`
          : 'Leave translatedText empty unless translation was requested.',
      ].join('\n');

      const structuredResponse = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [audioPart, { text: structPrompt }],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              language: {
                type: Type.STRING,
                description: 'Full human-readable name of the detected primary spoken language (e.g., English, Spanish, Japanese).',
              },
              languageCode: {
                type: Type.STRING,
                description: 'ISO 639-1 two-letter language code (e.g., en, es, ja).',
              },
              translatedText: {
                type: Type.STRING,
                description: 'Full transcript translated into target language if requested, otherwise empty string.',
              },
              segments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.INTEGER },
                    start: { type: Type.NUMBER },
                    end: { type: Type.NUMBER },
                    speaker: { type: Type.STRING },
                    text: { type: Type.STRING },
                    translatedText: { type: Type.STRING },
                  },
                  required: ['id', 'start', 'end', 'speaker', 'text'],
                },
              },
            },
            required: ['language', 'languageCode', 'segments'],
          },
        },
      });

      const parsed = JSON.parse((structuredResponse.text ?? '{}').trim());
      const segments = Array.isArray(parsed.segments) && parsed.segments.length > 0
        ? parsed.segments
        : [
            {
              id: 1,
              start: 0,
              end: durationSeconds || 5,
              speaker: 'Speaker 1',
              text: verbatimText,
              translatedText: parsed.translatedText || '',
            },
          ];

      res.json({
        text: verbatimText,
        translatedText: parsed.translatedText || '',
        language: parsed.language || 'Detected Speech',
        languageCode: parsed.languageCode || 'auto',
        task,
        durationSeconds,
        segments,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transcription request failed.';
      res.status(500).json({ detail: message });
    }
  });

  // Post-transcription intelligence: summary, action items, topics, or on-demand translation
  app.post('/api/analyze', async (req: Request, res: Response) => {
    try {
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      const mode = typeof req.body?.mode === 'string' ? req.body.mode : 'insights';
      const targetLanguage =
        typeof req.body?.targetLanguage === 'string' ? req.body.targetLanguage.trim().slice(0, 48) : 'Spanish';

      if (!text) {
        res.status(400).json({ detail: 'Transcript text is required.' });
        return;
      }
      if (text.length > 60000) {
        res.status(413).json({ detail: 'Transcript text exceeds 60,000 character limit.' });
        return;
      }

      const ai = getAiClient();

      if (mode === 'translate') {
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Translate the following transcript naturally and accurately into ${targetLanguage}, preserving paragraph breaks and meaning:\n\n${text}`,
        });
        res.json({ translatedText: (response.text ?? '').trim(), targetLanguage });
        return;
      }

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Analyze this audio transcript and extract a concise executive summary, key topics, action items, and overall tone.\n\nTranscript:\n${text}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING, description: '2-3 sentence summary of the audio.' },
              tone: { type: Type.STRING, description: 'Brief 1-3 word description of conversational tone.' },
              topics: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Up to 5 concise topic labels.',
              },
              actionItems: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Concrete follow-ups or tasks mentioned, or empty array if none.',
              },
            },
            required: ['summary', 'tone', 'topics', 'actionItems'],
          },
        },
      });

      const insights = JSON.parse((response.text ?? '{}').trim());
      res.json(insights);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Analysis failed.';
      res.status(500).json({ detail: message });
    }
  });

  // Generate real spoken WAV audio samples via gemini-3.8-flash-lite-tts for instant testing
  app.post('/api/sample-audio', async (req: Request, res: Response) => {
    try {
      const preset = typeof req.body?.preset === 'string' ? req.body.preset : 'standup';
      const customText = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 600) : '';

      const presets: Record<string, { text: string; voice: string; style: string; filename: string }> = {
        standup: {
          text: 'Morning team. Quick update on the speech service: we upgraded Faster-Whisper to support word-level timestamps, SRT subtitle exports, and a semaphore-guarded batch queue. Let us ship the staging build by four PM.',
          voice: 'Kore',
          style: 'Clear, natural engineering lead in a morning standup',
          filename: 'engineering_standup.wav',
        },
        multilingual: {
          text: 'Hola, gracias por llamar a soporte técnico. Hemos recibido tu archivo de audio y la transcripción automática ya está lista para revisión en el panel principal.',
          voice: 'Zephyr',
          style: 'Warm, articulate customer support specialist speaking Spanish',
          filename: 'spanish_support_call.wav',
        },
        keynote: {
          text: 'Audio intelligence starts with low-latency capture. When every spoken phrase maps cleanly to millisecond timestamps and structured action items, voice becomes searchable infrastructure.',
          voice: 'Charon',
          style: 'Measured, authoritative product keynote speaker',
          filename: 'product_keynote_clip.wav',
        },
      };

      const selected = presets[preset] || presets.standup;
      const speechText = customText || selected.text;

      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: speechText,
                speechMetadata: {
                  style: selected.style,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selected.voice },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        res.status(502).json({ detail: 'Audio synthesis did not return audio bytes.' });
        return;
      }

      res.json({
        audioBase64: base64Audio,
        mimeType: 'audio/wav',
        filename: customText ? 'custom_speech_sample.wav' : selected.filename,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sample audio synthesis failed.';
      res.status(500).json({ detail: message });
    }
  });

  // Multer & global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ detail: 'Audio file exceeds the 20 MB limit.' });
        return;
      }
      res.status(400).json({ detail: err.message });
      return;
    }
    res.status(400).json({ detail: err.message || 'Invalid request.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`WhisperCraft Studio running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
