import type { PythonFeatureFlags } from '../types/speech';

export function generateUpgradedPythonCode(flags: PythonFeatureFlags): string {
  const imports: string[] = [
    'import asyncio',
    'import os',
    'import tempfile',
    'from pathlib import Path',
    'from typing import List, Literal, Optional',
    '',
  ];

  if (flags.sseStreaming) {
    imports.push('import json');
  }
  if (flags.urlIngestion) {
    imports.push('import ipaddress');
    imports.push('import socket');
    imports.push('from urllib.parse import urlparse');
    imports.push('import httpx');
  }

  imports.push('from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile');
  if (flags.authAndCors) {
    imports.splice(
      imports.length - 1,
      1,
      'from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile',
      'from fastapi.middleware.cors import CORSMiddleware',
    );
  }
  if (flags.srtVttExport || flags.sseStreaming) {
    const responseTypes: string[] = [];
    if (flags.srtVttExport) responseTypes.push('PlainTextResponse');
    if (flags.sseStreaming) responseTypes.push('StreamingResponse');
    imports.push(`from fastapi.responses import ${responseTypes.join(', ')}`);
  }
  imports.push('from faster_whisper import WhisperModel');

  const sections: string[] = [imports.join('\n')];

  sections.push(`
app = FastAPI(title="Faster-Whisper Speech Service", version="2.0.0")

MODEL_NAME = os.getenv("WHISPER_MODEL", "small")
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
MAX_FILE_BYTES = int(os.getenv("MAX_AUDIO_MB", "20")) * 1024 * 1024
MAX_CONCURRENT_JOBS = int(os.getenv("MAX_CONCURRENT_JOBS", "2"))
TRANSCRIBE_SEMAPHORE = asyncio.Semaphore(MAX_CONCURRENT_JOBS)

# Load once when the service starts, not for every audio request.
model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE_TYPE)`);

  if (flags.authAndCors) {
    sections.push(`
API_KEY = os.getenv("SPEECH_SERVICE_API_KEY", "")
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def verify_api_key(x_api_key: Optional[str] = Header(default=None)):
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")`);
  }

  if (flags.srtVttExport) {
    sections.push(`

def _format_subtitle_time(seconds: float, decimal_sep: str = ",") -> str:
    hrs = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    ms = int(round((seconds - int(seconds)) * 1000))
    return f"{hrs:02d}:{mins:02d}:{secs:02d}{decimal_sep}{ms:03d}"


def _segments_to_srt(segments: list) -> str:
    blocks = []
    for idx, seg in enumerate(segments, start=1):
        start_ts = _format_subtitle_time(seg["start"], ",")
        end_ts = _format_subtitle_time(seg["end"], ",")
        blocks.append(f"{idx}\\n{start_ts} --> {end_ts}\\n{seg['text']}")
    return "\\n\\n".join(blocks)


def _segments_to_vtt(segments: list) -> str:
    blocks = ["WEBVTT", ""]
    for seg in segments:
        start_ts = _format_subtitle_time(seg["start"], ".")
        end_ts = _format_subtitle_time(seg["end"], ".")
        blocks.append(f"{start_ts} --> {end_ts}\\n{seg['text']}\\n")
    return "\\n".join(blocks)`);
  }

  if (flags.urlIngestion) {
    sections.push(`

def _validate_public_audio_url(raw_url: str) -> str:
    parsed = urlparse(raw_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Only http/https audio URLs are permitted")
    try:
        resolved_ip = socket.gethostbyname(parsed.hostname)
        ip_obj = ipaddress.ip_address(resolved_ip)
        if ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local:
            raise HTTPException(status_code=400, detail="Private or loopback URLs are blocked")
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="Could not resolve audio URL host")
    return raw_url`);
  }

  sections.push(`

@app.get("/health")
def health():
    return {
        "status": "UP",
        "model": MODEL_NAME,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
        "max_concurrent_jobs": MAX_CONCURRENT_JOBS,
    }`);

  const authDep = flags.authAndCors ? ', dependencies=[Depends(verify_api_key)]' : '';

  const transcribeParams: string[] = ['file: UploadFile = File(...)'];
  if (flags.taskAndLanguageParams) {
    transcribeParams.push('task: Literal["transcribe", "translate"] = Form("transcribe")');
    transcribeParams.push('language: Optional[str] = Form(None)');
  }
  if (flags.customVocabAndVad) {
    transcribeParams.push('initial_prompt: Optional[str] = Form(None)');
    transcribeParams.push('beam_size: int = Form(5, ge=1, le=10)');
    transcribeParams.push('vad_filter: bool = Form(True)');
    transcribeParams.push('min_silence_duration_ms: int = Form(500, ge=100, le=5000)');
  }
  if (flags.timestampsAndWords) {
    transcribeParams.push('word_timestamps: bool = Form(False)');
  }
  if (flags.srtVttExport) {
    transcribeParams.push('response_format: Literal["json", "srt", "vtt", "text"] = Query("json")');
  }

  const whisperCallArgs: string[] = [
    'temp_path,',
    `            language=${flags.taskAndLanguageParams ? 'language or None,' : 'None,'}`,
    `            task=${flags.taskAndLanguageParams ? 'task,' : '"transcribe",'}`,
    `            beam_size=${flags.customVocabAndVad ? 'beam_size,' : '5,'}`,
    `            vad_filter=${flags.customVocabAndVad ? 'vad_filter,' : 'True,'}`,
  ];
  if (flags.customVocabAndVad) {
    whisperCallArgs.push('            vad_parameters={"min_silence_duration_ms": min_silence_duration_ms},');
    whisperCallArgs.push('            initial_prompt=initial_prompt,');
  }
  if (flags.timestampsAndWords) {
    whisperCallArgs.push('            word_timestamps=word_timestamps,');
  }
  whisperCallArgs.push('            condition_on_previous_text=False,');

  const segmentSerialization = flags.timestampsAndWords
    ? `        serialized_segments = []
        for idx, segment in enumerate(segments, start=1):
            item = {
                "id": idx,
                "start": round(segment.start, 3),
                "end": round(segment.end, 3),
                "text": segment.text.strip(),
            }
            if word_timestamps and segment.words:
                item["words"] = [
                    {
                        "word": w.word.strip(),
                        "start": round(w.start, 3),
                        "end": round(w.end, 3),
                        "probability": round(w.probability, 4),
                    }
                    for w in segment.words
                ]
            serialized_segments.append(item)
        text = " ".join(s["text"] for s in serialized_segments).strip()`
    : `        serialized_segments = [
            {
                "id": idx,
                "start": round(segment.start, 3),
                "end": round(segment.end, 3),
                "text": segment.text.strip(),
            }
            for idx, segment in enumerate(segments, start=1)
        ]
        text = " ".join(s["text"] for s in serialized_segments).strip()`;

  const formatReturnBlock = flags.srtVttExport
    ? `        if response_format == "srt":
            return PlainTextResponse(_segments_to_srt(serialized_segments), media_type="application/x-subrip")
        if response_format == "vtt":
            return PlainTextResponse(_segments_to_vtt(serialized_segments), media_type="text/vtt")
        if response_format == "text":
            return PlainTextResponse(text, media_type="text/plain")
        return {
            "text": text,
            "language": info.language,
            "language_probability": round(info.language_probability, 4),
            "duration": round(info.duration, 2),
            "segments": serialized_segments,
        }`
    : `        return {
            "text": text,
            "language": info.language,
            "language_probability": round(info.language_probability, 4),
            "duration": round(info.duration, 2),
            "segments": serialized_segments,
        }`;

  const syncCallArgs = ['temp_path'];
  if (flags.taskAndLanguageParams) {
    syncCallArgs.push('task', 'language');
  }
  if (flags.customVocabAndVad) {
    syncCallArgs.push('initial_prompt', 'beam_size', 'vad_filter', 'min_silence_duration_ms');
  }
  if (flags.timestampsAndWords) {
    syncCallArgs.push('word_timestamps');
  }

  sections.push(`

def _run_transcribe_sync(${syncCallArgs
    .map((arg) => {
      if (arg === 'temp_path') return 'temp_path: str';
      if (arg === 'task') return 'task: str';
      if (arg === 'language') return 'language: Optional[str]';
      if (arg === 'initial_prompt') return 'initial_prompt: Optional[str]';
      if (arg === 'beam_size') return 'beam_size: int';
      if (arg === 'vad_filter') return 'vad_filter: bool';
      if (arg === 'min_silence_duration_ms') return 'min_silence_duration_ms: int';
      if (arg === 'word_timestamps') return 'word_timestamps: bool';
      return arg;
    })
    .join(', ')}):
    segments_gen, info = model.transcribe(
        ${whisperCallArgs.join('\n').replace(/^            /gm, '        ')}
    )
    return list(segments_gen), info


@app.post("/transcribe"${authDep})
async def transcribe(
    ${transcribeParams.join(',\n    ')},
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Audio filename is required")

    suffix = Path(file.filename).suffix or ".webm"
    temp_path = None
    try:
        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=400, detail="Audio file is empty")
        if len(contents) > MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail="Audio file exceeds size limit")

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
            temp.write(contents)
            temp_path = temp.name

        async with TRANSCRIBE_SEMAPHORE:
            segments, info = await asyncio.to_thread(
                _run_transcribe_sync,
                ${syncCallArgs.join(',\n                ')},
            )

${segmentSerialization}
${formatReturnBlock}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not transcribe audio: {exc}")
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)`);

  if (flags.sseStreaming) {
    sections.push(`

@app.post("/transcribe/stream"${authDep})
async def transcribe_stream(
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
    task: Literal["transcribe", "translate"] = Form("transcribe"),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Audio filename is required")
    contents = await file.read()
    if not contents or len(contents) > MAX_FILE_BYTES:
        raise HTTPException(status_code=400, detail="Invalid or oversized audio file")

    suffix = Path(file.filename).suffix or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
        temp.write(contents)
        temp_path = temp.name

    async def event_generator():
        try:
            async with TRANSCRIBE_SEMAPHORE:
                segments, info = model.transcribe(
                    temp_path,
                    language=language or None,
                    task=task,
                    vad_filter=True,
                )
                yield f"data: {json.dumps({'event': 'meta', 'language': info.language, 'duration': info.duration})}\\n\\n"
                for idx, seg in enumerate(segments, start=1):
                    payload = {
                        "event": "segment",
                        "id": idx,
                        "start": round(seg.start, 3),
                        "end": round(seg.end, 3),
                        "text": seg.text.strip(),
                    }
                    yield f"data: {json.dumps(payload)}\\n\\n"
                    await asyncio.sleep(0)
                yield f"data: {json.dumps({'event': 'done'})}\\n\\n"
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    return StreamingResponse(event_generator(), media_type="text/event-stream")`);
  }

  if (flags.batchEndpoint) {
    sections.push(`

@app.post("/transcribe/batch"${authDep})
async def transcribe_batch(
    files: List[UploadFile] = File(...),
    task: Literal["transcribe", "translate"] = Form("transcribe"),
):
    if not files or len(files) > 10:
        raise HTTPException(status_code=400, detail="Provide between 1 and 10 audio files")

    async def process_one(upload: UploadFile):
        suffix = Path(upload.filename or "audio.webm").suffix or ".webm"
        contents = await upload.read()
        if not contents or len(contents) > MAX_FILE_BYTES:
            return {"filename": upload.filename, "error": "Empty or oversized file"}
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
                temp.write(contents)
                temp_path = temp.name
            async with TRANSCRIBE_SEMAPHORE:
                segments, info = await asyncio.to_thread(
                    model.transcribe,
                    temp_path,
                    task=task,
                    vad_filter=True,
                )
                text = " ".join(seg.text.strip() for seg in segments).strip()
                return {"filename": upload.filename, "language": info.language, "text": text}
        finally:
            if temp_path and os.path.exists(temp_path):
                os.remove(temp_path)

    results = await asyncio.gather(*(process_one(f) for f in files))
    return {"count": len(results), "results": results}`);
  }

  if (flags.urlIngestion) {
    sections.push(`

@app.post("/transcribe/url"${authDep})
async def transcribe_from_url(
    url: str = Form(...),
    task: Literal["transcribe", "translate"] = Form("transcribe"),
):
    safe_url = _validate_public_audio_url(url)
    temp_path = None
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
            resp = await client.get(safe_url)
            resp.raise_for_status()
            if len(resp.content) > MAX_FILE_BYTES:
                raise HTTPException(status_code=413, detail="Remote audio exceeds size limit")
        suffix = Path(urlparse(safe_url).path).suffix or ".mp3"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
            temp.write(resp.content)
            temp_path = temp.name
        async with TRANSCRIBE_SEMAPHORE:
            segments, info = await asyncio.to_thread(
                model.transcribe,
                temp_path,
                task=task,
                vad_filter=True,
            )
            text = " ".join(seg.text.strip() for seg in segments).strip()
        return {"text": text, "language": info.language, "source_url": safe_url}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Failed to transcribe URL: {exc}")
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)`);
  }

  return sections
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s*,\n/gm, '')
    .trim() + '\n';
}

export function generateRequirementsTxt(flags: PythonFeatureFlags): string {
  const deps = [
    'fastapi>=0.115.0',
    'uvicorn[standard]>=0.32.0',
    'python-multipart>=0.0.17',
    'faster-whisper>=1.1.0',
  ];
  if (flags.urlIngestion) {
    deps.push('httpx>=0.28.0');
  }
  return deps.join('\n') + '\n';
}
