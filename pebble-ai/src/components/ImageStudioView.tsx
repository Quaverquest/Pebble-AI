import React, { useEffect, useRef, useState } from 'react';
import {
  Brush,
  Download,
  Eraser,
  Heart,
  Image as ImageIcon,
  Layers,
  Pencil,
  RotateCcw,
  Scissors,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  Wand2,
} from 'lucide-react';
import type { GeneratedImageRecord, ModelEntry, PebbleSettings } from '../core/types';

interface ImageStudioViewProps {
  images: GeneratedImageRecord[];
  models: ModelEntry[];
  settings: PebbleSettings;
  pendingPrompt?: string | null;
  onConsumePendingPrompt?: () => void;
  onStateRefresh: () => Promise<void>;
}

type StudioTab = 'generate' | 'edit' | 'gallery';
type EditMode = 'edit' | 'remove_object' | 'remove_background' | 'variation';

export const ImageStudioView: React.FC<ImageStudioViewProps> = ({
  images,
  models,
  settings,
  pendingPrompt,
  onConsumePendingPrompt,
  onStateRefresh,
}) => {
  const [tab, setTab] = useState<StudioTab>('generate');
  const [prompt, setPrompt] = useState(
    'Architectural photograph of a quiet cedar cabin studio overlooking misty pines at dawn, warm interior light, 35mm film grain'
  );
  const [negativePrompt, setNegativePrompt] = useState('blurry, distorted proportions, watermark');
  const [aspectRatio, setAspectRatio] = useState<GeneratedImageRecord['aspectRatio']>('4:3');
  const [steps, setSteps] = useState(24);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 999999));
  const [batchCount, setBatchCount] = useState(1);
  const [lowVramProfile, setLowVramProfile] = useState(settings.qwenLowVramEnabled);
  const [selectedModelId, setSelectedModelId] = useState('pebble-image-normal');
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [activeResult, setActiveResult] = useState<GeneratedImageRecord | null>(images[0] ?? null);

  // Edit & Mask state
  const [editSourceUrl, setEditSourceUrl] = useState<string>(images[0]?.imageUrl ?? '');
  const [editMode, setEditMode] = useState<EditMode>('edit');
  const [editInstruction, setEditInstruction] = useState(
    'Replace the masked area with a sunlit Nordic glass conservatory'
  );
  const [brushSize, setBrushSize] = useState(28);
  const [isErasing, setIsErasing] = useState(false);
  const [cutoutSensitivity, setCutoutSensitivity] = useState(36);
  const [maskCoveragePct, setMaskCoveragePct] = useState(0);
  const [undoDepth, setUndoDepth] = useState(0);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number; visible: boolean }>({
    x: 0,
    y: 0,
    visible: false,
  });
  const [compareSlider, setCompareSlider] = useState(50);
  const [editedPreviewUrl, setEditedPreviewUrl] = useState<string | null>(null);
  const [galleryFilter, setGalleryFilter] = useState<'all' | 'favorites'>('all');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokeHistoryRef = useRef<ImageData[]>([]);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const imageModels = models.filter(
    (m) =>
      m.supportedTasks.includes('image_generation') ||
      m.supportedTasks.includes('image_editing')
  );
  const selectedModel =
    imageModels.find((m) => m.id === selectedModelId) ?? imageModels[0];

  useEffect(() => {
    if (pendingPrompt) {
      setPrompt(pendingPrompt);
      setTab('generate');
      onConsumePendingPrompt?.();
      void handleGenerate(pendingPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt]);

  useEffect(() => {
    if (!activeResult && images.length > 0) {
      setActiveResult(images[0]);
    }
    if (!editSourceUrl && images.length > 0) {
      setEditSourceUrl(images[0].imageUrl);
    }
  }, [images, activeResult, editSourceUrl]);

  const computeMaskCoverage = () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      setMaskCoveragePct(0);
      return;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let maskedPixels = 0;
    const stride = 16;
    let samples = 0;
    for (let i = 3; i < data.length; i += stride) {
      samples += 1;
      if (data[i] > 20) maskedPixels += 1;
    }
    setMaskCoveragePct(samples > 0 ? Math.round((maskedPixels / samples) * 1000) / 10 : 0);
  };

  const pushStrokeHistory = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    strokeHistoryRef.current = [...strokeHistoryRef.current.slice(-19), snapshot];
    setUndoDepth(strokeHistoryRef.current.length);
  };

  const handleUndoStroke = () => {
    const canvas = canvasRef.current;
    if (!canvas || strokeHistoryRef.current.length === 0) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const prev = strokeHistoryRef.current[strokeHistoryRef.current.length - 1];
    strokeHistoryRef.current = strokeHistoryRef.current.slice(0, -1);
    ctx.putImageData(prev, 0, 0);
    setUndoDepth(strokeHistoryRef.current.length);
    computeMaskCoverage();
  };

  const handleInvertMask = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    pushStrokeHistory();
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    const fillRgb = editMode === 'remove_object' ? [220, 38, 38] : [22, 163, 74];
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 20) {
        d[i + 3] = 0;
      } else {
        d[i] = fillRgb[0];
        d[i + 1] = fillRgb[1];
        d[i + 2] = fillRgb[2];
        d[i + 3] = 138;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    computeMaskCoverage();
  };

  const handleModeChange = (next: EditMode) => {
    setEditMode(next);
    setStatusNotice(null);
    setErrorMsg(null);
    if (next === 'remove_object') {
      setEditInstruction('Remove the brushed object cleanly and reconstruct the background texture seamlessly');
    } else if (next === 'remove_background') {
      setEditInstruction('Isolate primary foreground subject on a clean transparent RGBA alpha cutout');
    } else if (next === 'variation') {
      setEditInstruction('Create a refined lighting and composition variation while preserving core subject identity');
    } else {
      setEditInstruction('Replace the masked area with a sunlit Nordic glass conservatory');
    }
  };

  const handleGenerate = async (overridePrompt?: string) => {
    const finalPrompt = (overridePrompt ?? prompt).trim();
    if (!finalPrompt || generating) return;
    setGenerating(true);
    setErrorMsg(null);
    setStatusNotice(null);

    try {
      const res = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: finalPrompt,
          negativePrompt,
          modelId: selectedModel?.id ?? selectedModelId,
          mode: 'generate',
          aspectRatio,
          steps,
          seed,
          batchCount,
          lowVramProfile,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Image generation failed');
      if (data.images?.[0]) {
        setActiveResult(data.images[0]);
      }
      await onStateRefresh();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const handleApplyEdit = async () => {
    if (!editSourceUrl || generating) return;
    const instruction =
      editMode === 'remove_background'
        ? 'Remove background cleanly and isolate the subject with transparent backdrop'
        : editInstruction.trim();
    if (!instruction) return;

    setGenerating(true);
    setErrorMsg(null);
    setStatusNotice(null);
    try {
      const usesMask = editMode === 'edit' || editMode === 'remove_object';
      const maskDataUrl =
        usesMask && canvasRef.current ? canvasRef.current.toDataURL('image/png') : undefined;

      const res = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: instruction,
          modelId: selectedModel?.id ?? selectedModelId,
          mode: editMode,
          aspectRatio,
          steps,
          seed,
          batchCount: 1,
          lowVramProfile,
          sourceImageDataUrl: editSourceUrl,
          maskDataUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Image editing failed');
      if (data.images?.[0]) {
        setEditedPreviewUrl(data.images[0].imageUrl);
        setActiveResult(data.images[0]);
        setStatusNotice(`Saved ${editMode.replace(/_/g, ' ')} result to Image Lab Gallery.`);
      }
      await onStateRefresh();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  /**
   * One-click background removal via 4-edge flood-seeded segmentation + local edge
   * gradient barrier + brush-protected foreground pixels + soft alpha feathering.
   */
  const handleOneClickRemoveBackground = async (sourceUrlOverride?: string) => {
    const targetUrl = sourceUrlOverride || editSourceUrl || activeResult?.imageUrl;
    if (!targetUrl || generating) return;
    setGenerating(true);
    setErrorMsg(null);
    setStatusNotice(null);

    try {
      const img = await loadImageForCanvas(targetUrl);
      const offscreen = document.createElement('canvas');
      offscreen.width = Math.min(896, img.naturalWidth || 768);
      offscreen.height = Math.min(896, img.naturalHeight || 576);
      const ctx = offscreen.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      ctx.drawImage(img, 0, 0, offscreen.width, offscreen.height);

      const frame = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
      const d = frame.data;
      const w = offscreen.width;
      const h = offscreen.height;
      const totalPixels = w * h;

      // Optional brush protection mask (when called from Edit & Mask)
      let scaledMaskData: Uint8ClampedArray | null = null;
      if (!sourceUrlOverride && canvasRef.current && maskCoveragePct > 0.2) {
        const maskCopy = document.createElement('canvas');
        maskCopy.width = w;
        maskCopy.height = h;
        const mCtx = maskCopy.getContext('2d', { willReadFrequently: true });
        if (mCtx) {
          mCtx.drawImage(canvasRef.current, 0, 0, w, h);
          scaledMaskData = mCtx.getImageData(0, 0, w, h).data;
        }
      }

      // Compute perimeter average RGB for secondary soft edge refinement
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let bCount = 0;
      const borderStep = Math.max(1, Math.floor(Math.min(w, h) / 48));
      for (let x = 0; x < w; x += borderStep) {
        const t = x * 4;
        const b = ((h - 1) * w + x) * 4;
        rSum += d[t] + d[b];
        gSum += d[t + 1] + d[b + 1];
        bSum += d[t + 2] + d[b + 2];
        bCount += 2;
      }
      const meanBgR = rSum / Math.max(1, bCount);
      const meanBgG = gSum / Math.max(1, bCount);
      const meanBgB = bSum / Math.max(1, bCount);

      // 4-edge BFS Flood Segmentation from image borders
      const visited = new Uint8Array(totalPixels);
      const isBackground = new Uint8Array(totalPixels);
      const queue = new Int32Array(totalPixels);
      let head = 0;
      let tail = 0;

      const stepThreshold = Math.max(18, cutoutSensitivity * 0.92);
      const globalThreshold = cutoutSensitivity * 2.15;

      const enqueueSeed = (idx: number) => {
        if (visited[idx]) return;
        const px = idx * 4;
        if (scaledMaskData && scaledMaskData[px + 3] > 25) return;
        visited[idx] = 1;
        isBackground[idx] = 1;
        queue[tail++] = idx;
      };

      for (let x = 0; x < w; x++) {
        enqueueSeed(x);
        enqueueSeed((h - 1) * w + x);
      }
      for (let y = 0; y < h; y++) {
        enqueueSeed(y * w);
        enqueueSeed(y * w + (w - 1));
      }

      while (head < tail) {
        const curr = queue[head++];
        const cPx = curr * 4;
        const cr = d[cPx];
        const cg = d[cPx + 1];
        const cb = d[cPx + 2];

        const cx = curr % w;
        const cy = (curr - cx) / w;

        const neighbors = [
          cx > 0 ? curr - 1 : -1,
          cx < w - 1 ? curr + 1 : -1,
          cy > 0 ? curr - w : -1,
          cy < h - 1 ? curr + w : -1,
        ];

        for (let k = 0; k < 4; k++) {
          const n = neighbors[k];
          if (n < 0 || visited[n]) continue;
          const nPx = n * 4;
          if (scaledMaskData && scaledMaskData[nPx + 3] > 25) {
            visited[n] = 1;
            continue;
          }

          const localDiff = Math.sqrt(
            (d[nPx] - cr) ** 2 + (d[nPx + 1] - cg) ** 2 + (d[nPx + 2] - cb) ** 2
          );
          const bgDiff = Math.sqrt(
            (d[nPx] - meanBgR) ** 2 + (d[nPx + 1] - meanBgG) ** 2 + (d[nPx + 2] - meanBgB) ** 2
          );

          if (localDiff <= stepThreshold && bgDiff <= globalThreshold) {
            visited[n] = 1;
            isBackground[n] = 1;
            queue[tail++] = n;
          }
        }
      }

      // Apply alpha with 1px soft halo feather around non-background foreground borders
      for (let idx = 0; idx < totalPixels; idx++) {
        const px = idx * 4;
        if (scaledMaskData && scaledMaskData[px + 3] > 25) {
          d[px + 3] = 255;
          continue;
        }
        if (isBackground[idx]) {
          d[px + 3] = 0;
        } else {
          const x = idx % w;
          const y = (idx - x) / w;
          let bgNeighbors = 0;
          if (x > 0 && isBackground[idx - 1]) bgNeighbors++;
          if (x < w - 1 && isBackground[idx + 1]) bgNeighbors++;
          if (y > 0 && isBackground[idx - w]) bgNeighbors++;
          if (y < h - 1 && isBackground[idx + w]) bgNeighbors++;
          if (bgNeighbors >= 2) {
            d[px + 3] = Math.round(d[px + 3] * 0.58);
          }
        }
      }

      ctx.putImageData(frame, 0, 0);
      const pngDataUrl = offscreen.toDataURL('image/png');

      const res = await fetch('/api/images/save-cutout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl: pngDataUrl,
          prompt: `One-Click Background Removal Cutout (${selectedModel?.name ?? 'Edge Segmentation'})`,
          modelId: selectedModel?.id ?? selectedModelId,
          width: w,
          height: h,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save transparent cutout');

      setEditedPreviewUrl(data.image.imageUrl);
      setActiveResult(data.image);
      setStatusNotice('One-click background removal complete — transparent PNG cutout saved to Image Lab Gallery.');
      await onStateRefresh();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const handleUploadSource = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setEditSourceUrl(String(reader.result));
      setEditedPreviewUrl(null);
      clearMaskCanvas();
    };
    reader.readAsDataURL(file);
  };

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
      cssX: e.clientX - rect.left,
      cssY: e.clientY - rect.top,
    };
  };

  const drawMaskStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const pt = getCanvasPoint(e);
    if (!canvas || !pt) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.globalCompositeOperation = isErasing ? 'destination-out' : 'source-over';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brushSize * 2;
    const strokeRgba =
      editMode === 'remove_object' ? 'rgba(220, 38, 38, 0.55)' : 'rgba(22, 163, 74, 0.55)';
    ctx.strokeStyle = isErasing ? 'rgba(0,0,0,1)' : strokeRgba;
    ctx.fillStyle = isErasing ? 'rgba(0,0,0,1)' : strokeRgba;

    if (lastPointRef.current) {
      ctx.beginPath();
      ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, brushSize, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    lastPointRef.current = { x: pt.x, y: pt.y };
  };

  const clearMaskCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    strokeHistoryRef.current = [];
    setUndoDepth(0);
    setMaskCoveragePct(0);
  };

  const toggleFavorite = async (id: string) => {
    await fetch(`/api/images/${id}/favorite`, { method: 'PATCH' });
    await onStateRefresh();
  };

  const deleteImage = async (id: string) => {
    await fetch(`/api/images/${id}`, { method: 'DELETE' });
    await onStateRefresh();
  };

  const visibleGallery =
    galleryFilter === 'favorites' ? images.filter((i) => i.favorite) : images;

  const showBrushCanvas = editMode !== 'variation' && !editedPreviewUrl;

  return (
    <div className="max-w-[1320px] mx-auto px-6 py-6 space-y-6">
      {/* Lab Header & Mode Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--pebble-panel-border)] pb-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">
            Pebble Image Lab
          </h1>
          <p className="text-xs text-[var(--pebble-text-secondary)] mt-1 tabular-nums">
            Model: {selectedModel?.name} · {selectedModel?.tier?.toUpperCase() || 'Open'} · {selectedModel?.quantization} · {selectedModel?.compatibility.recommendedBackend.replace(/_/g, ' ')}
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl pebble-glass-subtle">
          {(
            [
              { id: 'generate', label: 'Generate' },
              { id: 'edit', label: 'Edit & Mask' },
              { id: 'gallery', label: `Gallery (${images.length})` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                tab === t.id
                  ? 'pebble-accent-btn shadow-sm'
                  : 'text-[var(--pebble-text-secondary)] hover:text-[var(--pebble-text-primary)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-xl border border-red-500/30 bg-red-500/15 text-xs text-red-700 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      {statusNotice && (
        <div className="p-3.5 rounded-xl border border-emerald-700/30 bg-emerald-800/15 text-xs text-emerald-800 dark:text-emerald-300">
          {statusNotice}
        </div>
      )}

      {/* GENERATE WORKSPACE */}
      {tab === 'generate' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Controls Column */}
          <div className="lg:col-span-5 rounded-2xl pebble-glass p-5 space-y-4">
            <div>
              <label htmlFor="img-model-select" className="block text-xs font-medium text-[var(--pebble-text-secondary)] mb-1.5">
                Pebble & Open-Source Image Model
              </label>
              <select
                id="img-model-select"
                value={selectedModel?.id ?? selectedModelId}
                onChange={(e) => setSelectedModelId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl pebble-glass-subtle text-xs font-medium"
              >
                {imageModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.quantization}) — {m.censorship === 'uncensored' ? 'Uncensored' : 'Standard'} · {m.compatibility.tier}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="img-prompt-input" className="block text-xs font-medium text-[var(--pebble-text-secondary)] mb-1.5">
                Prompt
              </label>
              <textarea
                id="img-prompt-input"
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe subject, lighting, lens, typography, or composition..."
                className="w-full px-3.5 py-2.5 rounded-xl pebble-glass-subtle text-sm focus:outline-none focus:border-[var(--pebble-accent)] resize-none"
              />
            </div>

            <div>
              <label htmlFor="img-neg-prompt" className="block text-xs font-medium text-[var(--pebble-text-secondary)] mb-1.5">
                Negative Prompt
              </label>
              <input
                id="img-neg-prompt"
                type="text"
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                className="w-full px-3 py-2 rounded-xl pebble-glass-subtle text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="aspect-select" className="block text-xs font-medium text-[var(--pebble-text-secondary)] mb-1">
                  Aspect Ratio
                </label>
                <select
                  id="aspect-select"
                  value={aspectRatio}
                  onChange={(e) =>
                    setAspectRatio(e.target.value as GeneratedImageRecord['aspectRatio'])
                  }
                  className="w-full px-3 py-2 rounded-xl pebble-glass-subtle text-xs font-mono"
                >
                  <option value="1:1">1:1 (768x768)</option>
                  <option value="4:3">4:3 (768x576)</option>
                  <option value="3:4">3:4 (576x768)</option>
                  <option value="16:9">16:9 (896x512)</option>
                  <option value="9:16">9:16 (512x896)</option>
                </select>
              </div>
              <div>
                <label htmlFor="batch-select" className="block text-xs font-medium text-[var(--pebble-text-secondary)] mb-1">
                  Batch Count
                </label>
                <select
                  id="batch-select"
                  value={batchCount}
                  onChange={(e) => setBatchCount(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl pebble-glass-subtle text-xs font-mono"
                >
                  <option value={1}>1 image (4GB safe)</option>
                  <option value={2}>2 images (sequential)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 items-end">
              <div>
                <label htmlFor="steps-slider" className="block text-xs font-medium text-[var(--pebble-text-secondary)] mb-1 tabular-nums">
                  Inference Steps: {steps}
                </label>
                <input
                  id="steps-slider"
                  type="range"
                  min={12}
                  max={50}
                  value={steps}
                  onChange={(e) => setSteps(Number(e.target.value))}
                  className="w-full accent-emerald-700"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <div className="flex-1">
                  <label htmlFor="seed-input" className="block text-xs font-medium text-[var(--pebble-text-secondary)] mb-1">
                    Seed
                  </label>
                  <input
                    id="seed-input"
                    type="number"
                    value={seed}
                    onChange={(e) => setSeed(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded-lg pebble-glass-subtle text-xs font-mono"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setSeed(Math.floor(Math.random() * 999999))}
                  aria-label="Randomize seed"
                  className="p-2 rounded-lg pebble-glass-subtle hover:opacity-85"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <label className="flex items-center justify-between pt-2 border-t border-[var(--pebble-panel-border)] text-xs cursor-pointer">
              <span className="text-[var(--pebble-text-secondary)]">
                4GB VRAM DirectML / Vulkan Offload & Tiled VAE
              </span>
              <input
                type="checkbox"
                checked={lowVramProfile}
                onChange={(e) => setLowVramProfile(e.target.checked)}
                className="accent-emerald-700"
              />
            </label>

            <button
              type="button"
              disabled={generating || !prompt.trim()}
              onClick={() => void handleGenerate()}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl pebble-accent-btn disabled:opacity-50 text-sm font-semibold transition-colors whitespace-nowrap"
            >
              <Sparkles className="w-4 h-4" />
              <span>{generating ? 'Generating...' : `Generate with ${selectedModel?.name ?? 'Image Model'}`}</span>
            </button>
          </div>

          {/* Preview Viewport */}
          <div className="lg:col-span-7 rounded-2xl pebble-glass p-5 space-y-4">
            {activeResult ? (
              <>
                <div
                  className="relative rounded-xl overflow-hidden border border-[var(--pebble-panel-border)] flex items-center justify-center min-h-[380px]"
                  style={{
                    backgroundImage:
                      'linear-gradient(45deg, rgba(128,128,128,0.12) 25%, transparent 25%), linear-gradient(-45deg, rgba(128,128,128,0.12) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.12) 75%), linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.12) 75%)',
                    backgroundSize: '20px 20px',
                    backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
                    backgroundColor: 'rgba(12, 16, 18, 0.72)',
                  }}
                >
                  <img
                    src={activeResult.imageUrl}
                    alt={activeResult.prompt}
                    referrerPolicy="no-referrer"
                    className="max-h-[520px] w-auto object-contain"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="text-[var(--pebble-text-secondary)] font-mono tabular-nums">
                    {activeResult.modelName} · {activeResult.width}x{activeResult.height} · Seed {activeResult.seed} · {activeResult.backendUsed}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={generating}
                      onClick={() => void handleOneClickRemoveBackground(activeResult.imageUrl)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-600/40 bg-emerald-700/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-700/25 font-medium whitespace-nowrap"
                    >
                      <Scissors className="w-3.5 h-3.5" />
                      <span>One-Click Remove BG</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditSourceUrl(activeResult.imageUrl);
                        setEditedPreviewUrl(null);
                        setTab('edit');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg pebble-glass-subtle hover:opacity-85 whitespace-nowrap"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Open in Editor</span>
                    </button>
                    <a
                      href={activeResult.imageUrl}
                      download={`pebble-${activeResult.id}.png`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg pebble-glass-subtle hover:opacity-85 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </a>
                  </div>
                </div>
              </>
            ) : (
              <div className="h-[420px] flex flex-col items-center justify-center text-center text-[var(--pebble-text-secondary)] space-y-2">
                <ImageIcon className="w-8 h-8 opacity-40" />
                <p className="text-sm">Enter a prompt and generate your first image in Pebble Image Lab.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* EDIT & MASK WORKSPACE */}
      {tab === 'edit' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-4 rounded-2xl pebble-glass p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold">
                Brush, Removal & Matting
              </h2>
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/*"
                onChange={handleUploadSource}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => uploadInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg pebble-glass-subtle hover:opacity-85 text-xs font-medium whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Upload Image</span>
              </button>
            </div>

            <div>
              <label htmlFor="edit-model-select" className="block text-[11px] font-medium text-[var(--pebble-text-secondary)] mb-1">
                Editing Model
              </label>
              <select
                id="edit-model-select"
                value={selectedModel?.id ?? selectedModelId}
                onChange={(e) => setSelectedModelId(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl pebble-glass-subtle text-xs font-medium"
              >
                {imageModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.quantization})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { id: 'edit', label: 'Brush Edit' },
                  { id: 'remove_object', label: 'Remove Object' },
                  { id: 'remove_background', label: 'Remove Background' },
                  { id: 'variation', label: 'Variation' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleModeChange(m.id)}
                  className={`px-2.5 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    editMode === m.id
                      ? 'pebble-accent-btn'
                      : 'pebble-glass-subtle text-[var(--pebble-text-secondary)] hover:text-[var(--pebble-text-primary)]'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {editMode !== 'variation' && (
              <div className="p-3.5 rounded-xl pebble-glass-subtle space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--pebble-text-secondary)] font-mono tabular-nums">
                    Brush {brushSize}px · {maskCoveragePct}% painted
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setIsErasing(false)}
                      className={`p-1.5 rounded ${!isErasing ? 'pebble-accent-btn' : 'text-[var(--pebble-text-secondary)] hover:opacity-80'}`}
                      aria-label="Paint mask brush"
                      title="Paint selection"
                    >
                      <Brush className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsErasing(true)}
                      className={`p-1.5 rounded ${isErasing ? 'pebble-accent-btn' : 'text-[var(--pebble-text-secondary)] hover:opacity-80'}`}
                      aria-label="Erase mask"
                      title="Erase selection"
                    >
                      <Eraser className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={undoDepth === 0}
                      onClick={handleUndoStroke}
                      className="p-1.5 rounded text-[var(--pebble-text-secondary)] disabled:opacity-35"
                      aria-label="Undo brush stroke"
                      title="Undo stroke"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleInvertMask}
                      className="px-2 py-1 rounded text-[11px] text-[var(--pebble-text-secondary)] hover:opacity-80"
                    >
                      Invert
                    </button>
                    <button
                      type="button"
                      onClick={clearMaskCanvas}
                      className="px-2 py-1 rounded text-[11px] text-[var(--pebble-text-secondary)] hover:opacity-80"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  min={8}
                  max={64}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                  aria-label="Mask brush size"
                  className="w-full accent-emerald-700"
                />
                <p className="text-[11px] text-[var(--pebble-text-secondary)] leading-relaxed">
                  {editMode === 'remove_object'
                    ? 'Paint directly over any object or clutter you want removed.'
                    : editMode === 'remove_background'
                    ? 'Optional: brush over fine foreground edges to lock them before One-Click Remove Background.'
                    : 'Paint over the exact region you want to modify, then describe your edit below.'}
                </p>
              </div>
            )}

            {/* One-Click Segmentation Cutout always visible & prominent in Remove BG or quick mode */}
            <div className="p-3.5 rounded-xl border border-emerald-600/30 bg-emerald-700/10 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">
                  Edge Segmentation Sensitivity
                </span>
                <span className="font-mono text-[var(--pebble-text-secondary)] tabular-nums">{cutoutSensitivity}</span>
              </div>
              <input
                type="range"
                min={14}
                max={80}
                value={cutoutSensitivity}
                onChange={(e) => setCutoutSensitivity(Number(e.target.value))}
                aria-label="Background cutout sensitivity"
                className="w-full accent-emerald-700"
              />
              <button
                type="button"
                disabled={generating || !editSourceUrl}
                onClick={() => void handleOneClickRemoveBackground()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-600/40 bg-emerald-700/20 hover:bg-emerald-700/30 text-emerald-700 dark:text-emerald-200 text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <Scissors className="w-3.5 h-3.5" />
                <span>One-Click Remove Background (RGBA Cutout)</span>
              </button>
            </div>

            {editMode !== 'remove_background' && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'Remove brushed object and fill background naturally',
                    'Replace background with sunlit alpine studio',
                    'Turn lighting into warm golden hour cinematography',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setEditInstruction(preset)}
                      className="px-2.5 py-1 rounded-lg pebble-glass-subtle text-[11px] hover:opacity-85 text-left"
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <div>
                  <label htmlFor="edit-instruction-input" className="block text-xs font-medium text-[var(--pebble-text-secondary)] mb-1.5">
                    Edit Instruction
                  </label>
                  <textarea
                    id="edit-instruction-input"
                    rows={3}
                    value={editInstruction}
                    onChange={(e) => setEditInstruction(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl pebble-glass-subtle text-sm resize-none"
                  />
                </div>
              </>
            )}

            <button
              type="button"
              disabled={generating || !editSourceUrl}
              onClick={handleApplyEdit}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl pebble-accent-btn disabled:opacity-50 text-xs font-semibold transition-colors whitespace-nowrap"
            >
              {editMode === 'remove_background' ? (
                <Wand2 className="w-4 h-4" />
              ) : (
                <Layers className="w-4 h-4" />
              )}
              <span>
                {generating
                  ? 'Processing Edit...'
                  : editMode === 'remove_background'
                  ? 'AI Segmentation Background Removal'
                  : editMode === 'remove_object'
                  ? 'Remove Brushed Object'
                  : editMode === 'variation'
                  ? 'Generate Variation'
                  : 'Apply Brush Edit'}
              </span>
            </button>
          </div>

          <div className="lg:col-span-8 rounded-2xl pebble-glass p-5 space-y-4">
            {editSourceUrl ? (
              <>
                <div
                  className="relative w-full max-w-[680px] mx-auto rounded-xl overflow-hidden border border-[var(--pebble-panel-border)] select-none"
                  style={{
                    backgroundImage:
                      'linear-gradient(45deg, #222629 25%, transparent 25%), linear-gradient(-45deg, #222629 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #222629 75%), linear-gradient(-45deg, transparent 75%, #222629 75%)',
                    backgroundSize: '20px 20px',
                    backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
                    backgroundColor: '#16191B',
                  }}
                >
                  <img
                    src={editSourceUrl}
                    alt="Source image for editing"
                    referrerPolicy="no-referrer"
                    className="w-full h-auto block"
                  />
                  {editedPreviewUrl && (
                    <div
                      className="absolute inset-0 overflow-hidden"
                      style={{ clipPath: `inset(0 ${100 - compareSlider}% 0 0)` }}
                    >
                      <img
                        src={editedPreviewUrl}
                        alt="Edited result"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-contain"
                      />
                    </div>
                  )}
                  {showBrushCanvas && (
                    <>
                      <canvas
                        ref={canvasRef}
                        width={768}
                        height={576}
                        data-testid="mask-editor-canvas"
                        onPointerDown={(e) => {
                          pushStrokeHistory();
                          isDrawingRef.current = true;
                          lastPointRef.current = null;
                          drawMaskStroke(e);
                        }}
                        onPointerMove={(e) => {
                          const pt = getCanvasPoint(e);
                          if (pt) setCursorPos({ x: pt.cssX, y: pt.cssY, visible: true });
                          if (isDrawingRef.current) drawMaskStroke(e);
                        }}
                        onPointerUp={() => {
                          isDrawingRef.current = false;
                          lastPointRef.current = null;
                          computeMaskCoverage();
                        }}
                        onPointerLeave={() => {
                          isDrawingRef.current = false;
                          lastPointRef.current = null;
                          setCursorPos((p) => ({ ...p, visible: false }));
                          computeMaskCoverage();
                        }}
                        className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
                      />
                      {cursorPos.visible && (
                        <div
                          className="pointer-events-none absolute rounded-full border border-white/90 shadow-sm -translate-x-1/2 -translate-y-1/2"
                          style={{
                            left: cursorPos.x,
                            top: cursorPos.y,
                            width: Math.max(12, brushSize * 1.4),
                            height: Math.max(12, brushSize * 1.4),
                            backgroundColor:
                              editMode === 'remove_object'
                                ? 'rgba(220, 38, 38, 0.18)'
                                : 'rgba(22, 163, 74, 0.18)',
                          }}
                        />
                      )}
                    </>
                  )}
                </div>

                {editedPreviewUrl && (
                  <div className="max-w-[680px] mx-auto flex flex-wrap items-center gap-3 text-xs">
                    <span className="text-[var(--pebble-text-secondary)] whitespace-nowrap">Before / After</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={compareSlider}
                      onChange={(e) => setCompareSlider(Number(e.target.value))}
                      aria-label="Compare before and after"
                      className="flex-1 accent-emerald-700"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setEditSourceUrl(editedPreviewUrl);
                        setEditedPreviewUrl(null);
                        clearMaskCanvas();
                      }}
                      className="px-2.5 py-1 rounded-lg pebble-glass-subtle hover:opacity-85 whitespace-nowrap"
                    >
                      Use Result as Source
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditedPreviewUrl(null)}
                      className="text-[var(--pebble-accent)] hover:underline whitespace-nowrap"
                    >
                      Paint New Mask
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="h-96 flex items-center justify-center text-sm text-[var(--pebble-text-secondary)]">
                Upload an image or open one from the Gallery to paint masks, remove objects, or extract cutouts.
              </div>
            )}
          </div>
        </div>
      )}

      {/* GALLERY WORKSPACE */}
      {tab === 'gallery' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 p-1 rounded-lg pebble-glass-subtle">
              <button
                type="button"
                onClick={() => setGalleryFilter('all')}
                className={`px-3 py-1 rounded-md text-xs font-medium ${
                  galleryFilter === 'all'
                    ? 'pebble-accent-btn'
                    : 'text-[var(--pebble-text-secondary)]'
                }`}
              >
                All ({images.length})
              </button>
              <button
                type="button"
                onClick={() => setGalleryFilter('favorites')}
                className={`px-3 py-1 rounded-md text-xs font-medium ${
                  galleryFilter === 'favorites'
                    ? 'pebble-accent-btn'
                    : 'text-[var(--pebble-text-secondary)]'
                }`}
              >
                Favorites ({images.filter((i) => i.favorite).length})
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {visibleGallery.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl pebble-glass overflow-hidden flex flex-col"
              >
                <div
                  className="aspect-[4/3] overflow-hidden"
                  style={{
                    backgroundImage:
                      'linear-gradient(45deg, rgba(128,128,128,0.1) 25%, transparent 25%), linear-gradient(-45deg, rgba(128,128,128,0.1) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.1) 75%), linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.1) 75%)',
                    backgroundSize: '16px 16px',
                    backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                    backgroundColor: '#121517',
                  }}
                >
                  <img
                    src={item.imageUrl}
                    alt={item.prompt}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                  <div className="space-y-1">
                    <div className="text-[11px] font-mono text-[var(--pebble-accent)] tabular-nums">
                      {item.modelName} · {item.width}x{item.height} · Seed {item.seed}
                    </div>
                    <p className="text-xs text-[var(--pebble-text-secondary)] line-clamp-2">
                      {item.prompt}
                    </p>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-[var(--pebble-panel-border)]">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void toggleFavorite(item.id)}
                        aria-label={`Favorite image ${item.id}`}
                        className={`p-1.5 rounded-lg hover:bg-white/10 ${
                          item.favorite ? 'text-red-500' : 'text-[var(--pebble-text-secondary)]'
                        }`}
                      >
                        <Heart className="w-4 h-4" fill={item.favorite ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPrompt(item.prompt);
                          setSeed(item.seed);
                          setTab('generate');
                        }}
                        className="px-2 py-1 rounded-lg text-xs text-[var(--pebble-text-secondary)] hover:bg-white/10"
                      >
                        Reuse
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditSourceUrl(item.imageUrl);
                          setEditedPreviewUrl(null);
                          setTab('edit');
                        }}
                        className="px-2 py-1 rounded-lg text-xs text-[var(--pebble-text-secondary)] hover:bg-white/10"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleOneClickRemoveBackground(item.imageUrl)}
                        title="One-Click Remove Background"
                        aria-label={`Remove background from ${item.id}`}
                        className="p-1.5 rounded-lg text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15"
                      >
                        <Scissors className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1">
                      <a
                        href={item.imageUrl}
                        download={`pebble-${item.id}.png`}
                        aria-label={`Download image ${item.id}`}
                        className="p-1.5 rounded-lg text-[var(--pebble-text-secondary)] hover:bg-white/10"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                      <button
                        type="button"
                        onClick={() => void deleteImage(item.id)}
                        aria-label={`Delete image ${item.id}`}
                        className="p-1.5 rounded-lg text-[var(--pebble-text-secondary)] hover:text-red-500 hover:bg-red-500/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

function loadImageForCanvas(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image pixels for canvas cutout'));
    img.src = url;
  });
}
