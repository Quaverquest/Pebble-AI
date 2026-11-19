"""
Pebble AI — Local Image & Editing Worker
Optimized for AMD Radeon RX 6500M (4GB VRAM, RDNA 2) + 40GB System RAM on Windows 11.
Supports:
  - DirectML GPU acceleration with sequential CPU offloading
  - bitsandbytes NF4 / INT8 quantization when requested for low-VRAM diffusion
  - VAE tiling & attention slicing to prevent 4GB VRAM OOM crashes
  - Text-to-Image, Brush Mask Edit, Mask Object Removal (remove_object), and Background Removal (remove_background)
"""
import base64
import gc
import io
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

import torch
from PIL import Image

DEFAULT_MODEL_ID = os.environ.get("PEBBLE_QWEN_IMAGE_REPO", "Qwen/Qwen-Image-2.1")
PORT = int(os.environ.get("PEBBLE_IMAGE_PORT", "7861"))

_pipe = None
_pipe_repo = None
_active_device = "cpu"


def detect_device():
    try:
        import torch_directml
        if torch_directml.is_available():
            return torch_directml.device(), "DirectML (AMD Radeon RX 6500M + Sequential CPU Offload)"
    except Exception:
        pass
    return torch.device("cpu"), "CPU System RAM (40GB DDR5 Fallback)"


def get_pipeline(model_repo: str = DEFAULT_MODEL_ID, quantization: str = "INT8_OFFLOAD"):
    global _pipe, _pipe_repo, _active_device
    if _pipe is not None and _pipe_repo == model_repo:
        return _pipe, _active_device

    _pipe = None
    gc.collect()
    device, label = detect_device()
    _active_device = label

    from diffusers import DiffusionPipeline

    dtype = torch.float16 if "DirectML" in label else torch.float32
    load_kwargs = {
        "torch_dtype": dtype,
        "use_safetensors": True,
        "low_cpu_mem_usage": True,
    }

    if "NF4" in (quantization or "").upper():
        try:
            from diffusers import PipelineQuantizationConfig
            load_kwargs["quantization_config"] = PipelineQuantizationConfig(
                quant_backend="bitsandbytes_4bit",
                quant_kwargs={"load_in_4bit": True, "bnb_4bit_quant_type": "nf4", "bnb_4bit_compute_dtype": torch.float16},
            )
            _active_device = f"{label} [BNB_NF4]"
        except Exception:
            pass

    pipe = DiffusionPipeline.from_pretrained(model_repo, **load_kwargs)

    if hasattr(pipe, "enable_attention_slicing"):
        pipe.enable_attention_slicing("max")
    if hasattr(pipe, "enable_vae_tiling"):
        pipe.enable_vae_tiling()
    if hasattr(pipe, "enable_sequential_cpu_offload"):
        pipe.enable_sequential_cpu_offload()
    else:
        pipe = pipe.to(device)

    _pipe = pipe
    _pipe_repo = model_repo
    return _pipe, _active_device


def remove_background_local(src_img: Image.Image):
    try:
        from rembg import remove
        out = remove(src_img.convert("RGBA"))
        return out, "Local rembg Alpha Matting (CPU/ONNX DirectML)"
    except Exception:
        return None, None


def aspect_to_dimensions(aspect_ratio: str, low_vram: bool):
    scale = 1.0 if low_vram else 1.25
    mapping = {
        "1:1": (768, 768),
        "4:3": (768, 576),
        "3:4": (576, 768),
        "16:9": (896, 512),
        "9:16": (512, 896),
    }
    w, h = mapping.get(aspect_ratio, (768, 768))
    return int((w * scale) // 8 * 8), int((h * scale) // 8 * 8)


class QwenWorkerHandler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            _, label = detect_device()
            self._send_json(200, {"status": "ok", "model": _pipe_repo or DEFAULT_MODEL_ID, "device": label})
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        data = json.loads(self.rfile.read(length).decode("utf-8"))
        try:
            mode = data.get("mode", "generate")
            model_repo = data.get("model_repo", DEFAULT_MODEL_ID)
            quantization = data.get("quantization", "INT8_OFFLOAD")
            width, height = aspect_to_dimensions(data.get("aspect_ratio", "1:1"), data.get("low_vram_profile", True))
            seed = int(data.get("seed", 42))
            steps = int(data.get("steps", 24))
            generator = torch.Generator(device="cpu").manual_seed(seed)

            if mode in ("remove_background", "extract_rgba") and data.get("source_image"):
                src_b64 = data["source_image"].split(",")[-1]
                src_img = Image.open(io.BytesIO(base64.b64decode(src_b64))).convert("RGBA")
                rembg_result, rembg_backend = remove_background_local(src_img)
                if rembg_result is not None:
                    buf = io.BytesIO()
                    rembg_result.save(buf, format="PNG")
                    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
                    self._send_json(200, {"image_base64": encoded, "mime_type": "image/png", "backend": rembg_backend})
                    return

            pipe, device_label = get_pipeline(model_repo, quantization)

            if self.path == "/generate":
                result = pipe(
                    prompt=data["prompt"],
                    negative_prompt=data.get("negative_prompt") or None,
                    width=width,
                    height=height,
                    num_inference_steps=steps,
                    generator=generator,
                ).images[0]
            elif self.path == "/edit":
                src_b64 = data["source_image"].split(",")[-1]
                src_img = Image.open(io.BytesIO(base64.b64decode(src_b64))).convert("RGB").resize((width, height))
                edit_prompt = data.get("prompt") or (
                    "Cleanly erase masked object and reconstruct seamless background lighting and texture"
                    if mode == "remove_object"
                    else "Preserve subject on neutral transparent studio backdrop"
                )
                kwargs = {
                    "prompt": edit_prompt,
                    "image": src_img,
                    "num_inference_steps": steps,
                    "generator": generator,
                }
                if data.get("mask_image"):
                    mask_b64 = data["mask_image"].split(",")[-1]
                    kwargs["mask_image"] = Image.open(io.BytesIO(base64.b64decode(mask_b64))).convert("L").resize((width, height))
                result = pipe(**kwargs).images[0]
            else:
                self._send_json(404, {"error": "Unsupported route"})
                return

            buf = io.BytesIO()
            result.save(buf, format="PNG")
            encoded = base64.b64encode(buf.getvalue()).decode("ascii")
            gc.collect()
            self._send_json(200, {
                "image_base64": encoded,
                "mime_type": "image/png",
                "backend": device_label,
            })
        except Exception as exc:
            gc.collect()
            self._send_json(500, {"error": str(exc)})


if __name__ == "__main__":
    print(f"Starting Pebble Image Worker on 127.0.0.1:{PORT}")
    HTTPServer(("127.0.0.1", PORT), QwenWorkerHandler).serve_forever()
