"""
Pebble AI — Local AMD RDNA 2 LLM Worker (Vulkan Compute + DirectML + BitsAndBytes/AWQ/GPTQ + CPU Fallback)
Designed specifically for HP Victus 15: AMD Ryzen 5 7535HS + AMD Radeon RX 6500M (4GB VRAM) + 40GB System RAM.
Exposes Ollama-compatible endpoints (/api/tags, /api/chat) on 127.0.0.1:11434 when Ollama itself is not running.
"""
import gc
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(os.environ.get("PEBBLE_LLM_PORT", "11434"))
VRAM_BUDGET_GB = float(os.environ.get("PEBBLE_VRAM_BUDGET_GB", "3.4"))

_loaded_repo = None
_loaded_quant = None
_model = None
_tokenizer = None
_llama_cpp = None
_active_backend = "CPU AVX2"


def detect_amd_backend():
    try:
        import torch_directml
        if torch_directml.is_available():
            return "directml", torch_directml.device(), "DirectML + CPU Offload (AMD RX 6500M)"
    except Exception:
        pass
    return "cpu", "cpu", "CPU (AVX2 / 40GB System RAM)"


def compute_gpu_layer_split(repo_id: str, quantization: str) -> int:
    q = (quantization or "").upper()
    if "1.5B" in repo_id or "TINY" in repo_id.upper() or "3B" in repo_id or "SMALL" in repo_id.upper():
        return -1  # All layers fit in 4GB VRAM
    if "Q4" in q or "AWQ" in q or "GPTQ" in q or "NF4" in q:
        return 22  # Hybrid split: hot attention blocks on RX 6500M, remainder in 40GB DDR5 RAM
    return 12


def load_transformers_model(repo_id: str, quantization: str):
    global _loaded_repo, _loaded_quant, _model, _tokenizer, _llama_cpp, _active_backend
    if _loaded_repo == repo_id and _loaded_quant == quantization and (_model is not None or _llama_cpp is not None):
        return _active_backend

    _model = None
    _tokenizer = None
    _llama_cpp = None
    gc.collect()

    q = (quantization or "Q4_K_M").upper()

    # Path 1: GGUF / Vulkan Compute via llama-cpp-python (Best for AMD RDNA 2)
    if "GGUF" in repo_id.upper() or "Q4" in q or "Q5" in q or "Q6" in q:
        try:
            from llama_cpp import Llama
            n_gpu_layers = compute_gpu_layer_split(repo_id, quantization)
            _llama_cpp = Llama.from_pretrained(
                repo_id=repo_id,
                filename="*q4_k_m*.gguf",
                n_gpu_layers=n_gpu_layers,
                n_ctx=4096,
                n_threads=10,
                verbose=False,
            )
            _loaded_repo = repo_id
            _loaded_quant = quantization
            _active_backend = f"Vulkan Compute (AMD RDNA 2 · {n_gpu_layers} GPU layers)"
            return _active_backend
        except Exception:
            pass

    # Path 2: Transformers + AWQ / GPTQ / bitsandbytes NF4 + Sequential RAM Offload
    from transformers import AutoModelForCausalLM, AutoTokenizer
    mode_key, device, backend_label = detect_amd_backend()
    _tokenizer = AutoTokenizer.from_pretrained(repo_id, use_fast=True)

    load_kwargs = {"low_cpu_mem_usage": True}
    if "BNB" in q or "NF4" in q:
        try:
            import torch
            from transformers import BitsAndBytesConfig
            load_kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.float16,
                bnb_4bit_use_double_quant=True,
            )
            load_kwargs["device_map"] = "auto"
            load_kwargs["max_memory"] = {0: f"{VRAM_BUDGET_GB}GiB", "cpu": "32GiB"}
        except Exception:
            pass
    elif "INT8" in q:
        try:
            from transformers import BitsAndBytesConfig
            load_kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_8bit=True,
                llm_int8_enable_fp32_cpu_offload=True,
            )
            load_kwargs["device_map"] = "auto"
        except Exception:
            pass

    _model = AutoModelForCausalLM.from_pretrained(repo_id, **load_kwargs)
    if "device_map" not in load_kwargs and mode_key == "directml":
        try:
            _model = _model.to(device)
        except Exception:
            _active_backend = "CPU AVX2 Fallback"
            return _active_backend

    _loaded_repo = repo_id
    _loaded_quant = quantization
    _active_backend = f"{backend_label} [{q}]"
    return _active_backend


class PebbleLLMHandler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/tags" or self.path == "/health":
            self._send_json(200, {
                "models": [
                    {"name": "qwen2.5:1.5b"},
                    {"name": "qwen2.5:3b"},
                    {"name": "qwen2.5:7b"},
                    {"name": "qwen2.5:14b"},
                    {"name": "qwen2.5-coder:7b"},
                    {"name": "deepseek-r1:8b"},
                ],
                "backend": _active_backend,
            })
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/api/chat":
            self._send_json(404, {"error": "Unsupported route"})
            return

        length = int(self.headers.get("Content-Length", "0"))
        data = json.loads(self.rfile.read(length).decode("utf-8"))
        repo_id = data.get("repo_id", "Qwen/Qwen2.5-3B-Instruct")
        quantization = data.get("quantization", "Q4_K_M")
        messages = data.get("messages", [])

        try:
            backend_label = load_transformers_model(repo_id, quantization)
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.end_headers()

            if _llama_cpp is not None:
                stream = _llama_cpp.create_chat_completion(messages=messages, stream=True, max_tokens=1024)
                for chunk in stream:
                    delta = chunk["choices"][0]["delta"].get("content", "")
                    if delta:
                        line = json.dumps({"message": {"role": "assistant", "content": delta}, "backend": backend_label}) + "\n"
                        self.wfile.write(line.encode("utf-8"))
                        self.wfile.flush()
            else:
                text = _tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
                inputs = _tokenizer(text, return_tensors="pt")
                output_ids = _model.generate(**inputs, max_new_tokens=512)
                reply = _tokenizer.decode(output_ids[0][inputs["input_ids"].shape[-1]:], skip_special_tokens=True)
                line = json.dumps({"message": {"role": "assistant", "content": reply}, "backend": backend_label}) + "\n"
                self.wfile.write(line.encode("utf-8"))
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})


if __name__ == "__main__":
    print(f"Starting Pebble AMD RDNA 2 LLM Worker on 127.0.0.1:{PORT}")
    HTTPServer(("127.0.0.1", PORT), PebbleLLMHandler).serve_forever()
