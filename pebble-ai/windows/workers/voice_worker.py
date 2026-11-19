"""
Pebble AI — Local Voice Worker (Whisper ASR + Piper/Kokoro TTS)
Runs exclusively in System RAM on AMD Ryzen 5 7535HS so RX 6500M 4GB VRAM stays free.
"""
import base64
import io
import json
import os
import tempfile
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(os.environ.get("PEBBLE_VOICE_PORT", "7862"))


class VoiceWorkerHandler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"status": "ok", "asr": "faster-whisper-small", "tts": "kokoro-82m"})
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        data = json.loads(self.rfile.read(length).decode("utf-8"))
        try:
            if self.path == "/transcribe":
                from faster_whisper import WhisperModel

                model = WhisperModel("small", device="cpu", compute_type="int8")
                audio_bytes = base64.b64decode(data["audio_base64"])
                with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
                    tmp.write(audio_bytes)
                    tmp_path = tmp.name
                segments, _ = model.transcribe(tmp_path, language=data.get("language", "en")[:2])
                os.unlink(tmp_path)
                text = " ".join(seg.text.strip() for seg in segments).strip()
                self._send_json(200, {"text": text})
                return

            if self.path == "/tts":
                import numpy as np
                from kokoro import KPipeline

                pipeline = KPipeline(lang_code="a")
                generator = pipeline(data["text"], voice="af_heart", speed=float(data.get("speed", 1.0)))
                chunks = [audio for _, _, audio in generator]
                pcm = (np.concatenate(chunks) * 32767).astype(np.int16)
                buf = io.BytesIO()
                with wave.open(buf, "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)
                    wf.setframerate(24000)
                    wf.writeframes(pcm.tobytes())
                self._send_json(200, {"wav_base64": base64.b64encode(buf.getvalue()).decode("ascii")})
                return

            self._send_json(404, {"error": "Unknown route"})
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})


if __name__ == "__main__":
    print(f"Starting Pebble Voice Worker on 127.0.0.1:{PORT}")
    HTTPServer(("127.0.0.1", PORT), VoiceWorkerHandler).serve_forever()
