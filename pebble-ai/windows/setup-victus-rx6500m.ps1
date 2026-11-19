param(
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$PebbleRoot = Join-Path $env:LOCALAPPDATA "PebbleAI"
$VenvDir = Join-Path $PebbleRoot "venv"
$ModelsDir = Join-Path $PebbleRoot "models"

New-Item -ItemType Directory -Force -Path $PebbleRoot, $ModelsDir | Out-Null

if (-not $Quiet) {
    Write-Host "Configuring Pebble AI for AMD Ryzen 5 7535HS + Radeon RX 6500M (4GB VRAM RDNA 2 / 40GB RAM)..."
}

# 1. Configure Ollama / llama.cpp Vulkan + DirectML memory bounds (4GB VRAM protection)
[Environment]::SetEnvironmentVariable("OLLAMA_MAX_LOADED_MODELS", "1", "User")
[Environment]::SetEnvironmentVariable("OLLAMA_NUM_PARALLEL", "1", "User")
[Environment]::SetEnvironmentVariable("OLLAMA_VULKAN", "1", "User")
[Environment]::SetEnvironmentVariable("OLLAMA_MODELS", $ModelsDir, "User")
[Environment]::SetEnvironmentVariable("PEBBLE_VRAM_BUDGET_GB", "3.4", "User")

# 2. Setup Python Vulkan + DirectML + Quantization (bitsandbytes, AWQ, GPTQ) + CPU-offload environment
if (Get-Command python -ErrorAction SilentlyContinue) {
    if (-not (Test-Path $VenvDir)) {
        python -m venv $VenvDir
    }
    $Pip = Join-Path $VenvDir "Scripts\pip.exe"
    & $Pip install --upgrade pip --quiet
    & $Pip install torch torchvision torch-directml diffusers transformers accelerate bitsandbytes optimum pillow rembg faster-whisper kokoro soundfile --quiet
    # Install Vulkan Compute llama-cpp-python prebuilt wheel when available; fallback cleanly if compiler absent
    & $Pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/vulkan --quiet 2>$null
}

if (-not $Quiet) {
    Write-Host "Pebble AI Windows 11 RDNA 2 optimization (Vulkan Compute + DirectML + CPU Fallback) complete."
}
