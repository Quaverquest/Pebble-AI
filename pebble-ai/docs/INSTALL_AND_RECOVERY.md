# Pebble AI — Windows 11 Installation & Recovery Guide

## Target Hardware Profile
- **Laptop**: HP Victus 15
- **CPU**: AMD Ryzen 5 7535HS (6 Cores / 12 Threads)
- **GPU**: AMD Radeon RX 6500M (4GB Dedicated VRAM, RDNA 2)
- **RAM**: 40GB DDR5
- **Storage**: 1TB Samsung NVMe SSD

---

## Building the Windows Installer (`Pebble-AI-Setup.exe`)

On your Windows 11 machine (with Node.js 22+ installed):

```powershell
npm install
npm run build
npx electron-builder --config windows/electron-builder.yml --win nsis
```

The installer will be created in `release/Pebble-AI-Setup-1.0.0.exe`.
Running `Pebble-AI-Setup-1.0.0.exe` creates:
- Desktop & Start Menu shortcuts (`Pebble AI`)
- Organized local storage in `%LOCALAPPDATA%\PebbleAI\` (`models`, `images`, `workspace`, `logs`)
- Optional DirectML + Qwen Image 2.1 + Whisper/Kokoro local Python worker virtual environment via `windows/setup-victus-rx6500m.ps1`

---

## Local Worker Startup (Automatic or Manual)

When running locally on Windows 11 without cloud keys:
1. **Chat / Coding / Reasoning**: Install Ollama for Windows (`OLLAMA_MAX_LOADED_MODELS=1`) and pull `qwen2.5:7b`, `qwen2.5-coder:7b`, `deepseek-r1:8b`, and `qwen2.5vl:3b`.
2. **Primary Image Model (`Qwen/Qwen-Image-2.1`)**:
   ```powershell
   %LOCALAPPDATA%\PebbleAI\venv\Scripts\python.exe windows\workers\qwen_image_worker.py
   ```
   Runs with `enable_sequential_cpu_offload()`, `enable_vae_tiling()`, and `enable_attention_slicing("max")` so the 7B model fits cleanly inside 4GB VRAM + 40GB DDR5 RAM.
3. **Local Voice (`faster-whisper-small` + `kokoro-82m`)**:
   ```powershell
   %LOCALAPPDATA%\PebbleAI\venv\Scripts\python.exe windows\workers\voice_worker.py
   ```
   Runs purely in system RAM so GPU VRAM stays free.

---

## Household Wi-Fi Remote Access
1. Open **Remote** in Pebble AI.
2. Share the displayed LAN URL (`http://192.168.x.x:3000/remote`) or scan the QR code from your phone/tablet.
3. Enter the 6-digit Pairing PIN. All AI models continue running exclusively on your HP Victus 15.

---

## OOM & Backend Recovery
- **Smart Resource Mode** automatically unloads idle models after 5 minutes (configurable) and guarantees only one major GPU model occupies the 4GB VRAM pool at a time.
- If a DirectML kernel reports out-of-memory, Pebble AI's Lifecycle Manager automatically retries the task in **CPU System RAM fallback mode** using your 40GB DDR5 pool without crashing the application.
- Conversations, settings, and generated images are persisted atomically in `data/pebble-state.json` and `data/images/`.
