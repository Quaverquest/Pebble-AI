import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Image as ImageIcon,
  Lock,
  Mic,
  MicOff,
  MousePointer2,
  Radio,
  Send,
  ShieldCheck,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { canModelControlPc } from '../core/safety';
import type { HardwareSpecs, ModelEntry, PebbleSettings, VoiceTranscriptEntry } from '../core/types';

interface VoiceViewProps {
  voiceHistory: VoiceTranscriptEntry[];
  settings: PebbleSettings;
  hardware: HardwareSpecs;
  models?: ModelEntry[];
  onUpdateSettings: (patch: Partial<PebbleSettings>) => Promise<void>;
  onStateRefresh: () => Promise<void>;
}

export const VoiceView: React.FC<VoiceViewProps> = ({
  voiceHistory,
  settings,
  hardware,
  models = [],
  onUpdateSettings,
  onStateRefresh,
}) => {
  const [recording, setRecording] = useState(false);
  const [handsFreeActive, setHandsFreeActive] = useState(settings.voice.continuousHandsFree);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [manualText, setManualText] = useState('');
  const [selectedModelId, setSelectedModelId] = useState<string>('auto');
  const [micLevel, setMicLevel] = useState(0);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [visualStage, setVisualStage] = useState<{
    imageUrl: string;
    prompt: string;
    label: string;
  } | null>(() => {
    const latestWithImg = [...voiceHistory].reverse().find((v) => v.generatedImageUrl);
    return latestWithImg?.generatedImageUrl
      ? {
          imageUrl: latestWithImg.generatedImageUrl,
          prompt: latestWithImg.generatedImagePrompt || latestWithImg.text,
          label: latestWithImg.actionLabel || 'Voice Visual Stage',
        }
      : null;
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const silenceSinceRef = useRef<number | null>(null);
  const hadSpeechRef = useRef(false);
  const handsFreeRef = useRef(handsFreeActive);
  const mutedRef = useRef(muted);

  const chatVoiceModels = models.filter(
    (m) =>
      m.supportedTasks.includes('general_chat') ||
      m.supportedTasks.includes('reasoning') ||
      m.supportedTasks.includes('image_generation')
  );
  const explicitModel =
    selectedModelId === 'auto'
      ? null
      : chatVoiceModels.find((m) => m.id === selectedModelId) ?? null;

  const pcPolicy = canModelControlPc(
    explicitModel,
    selectedModelId === 'auto' ? settings.activeRouterId : 'omni'
  );

  useEffect(() => {
    handsFreeRef.current = handsFreeActive;
  }, [handsFreeActive]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    if (navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          setAudioInputs(devices.filter((d) => d.kind === 'audioinput'));
        })
        .catch(() => {});
    }
    return () => {
      stopSpeaking();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const stopSpeaking = () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.currentTime = 0;
    }
    setSpeaking(false);
  };

  const startRecording = async () => {
    if (mutedRef.current) return;
    stopSpeaking();
    setErrorMsg(null);
    hadSpeechRef.current = false;
    silenceSinceRef.current = null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedMicId ? { deviceId: { exact: selectedMicId } } : true,
      });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        setMicLevel(0);
        stream.getTracks().forEach((t) => t.stop());
        void audioCtx.close();

        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size > 400) {
          await handleAudioBlob(blob);
        }
      };

      const monitorAudio = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const level = Math.min(100, Math.round(avg * 1.8));
        setMicLevel(level);

        if (handsFreeRef.current && recorder.state === 'recording') {
          if (level > 14) {
            hadSpeechRef.current = true;
            silenceSinceRef.current = null;
          } else if (hadSpeechRef.current) {
            if (!silenceSinceRef.current) {
              silenceSinceRef.current = Date.now();
            } else if (Date.now() - silenceSinceRef.current > 1300) {
              recorder.stop();
              setRecording(false);
              return;
            }
          }
        }
        rafRef.current = requestAnimationFrame(monitorAudio);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      monitorAudio();
    } catch (err) {
      setHandsFreeActive(false);
      setErrorMsg(
        `Microphone unavailable (${(err as Error).message}). Use the voice command bar or quick presets below to speak with Pebble Voice.`
      );
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  };

  const handleAudioBlob = async (blob: Blob) => {
    setProcessing(true);
    setErrorMsg(null);
    try {
      const base64 = await blobToBase64(blob);
      const transcribeRes = await fetch('/api/voice/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64: base64,
          mimeType: blob.type || 'audio/webm',
          language: settings.voice.language,
        }),
      });
      const trData = await transcribeRes.json();
      if (!transcribeRes.ok) throw new Error(trData.error || 'Transcription failed');
      if (trData.text?.trim()) {
        await runVoiceTurn(trData.text.trim());
      } else {
        setProcessing(false);
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
      setProcessing(false);
    }
  };

  const runVoiceTurn = async (spokenText: string) => {
    if (!spokenText.trim()) return;
    setProcessing(true);
    setErrorMsg(null);
    stopSpeaking();

    try {
      const res = await fetch('/api/voice/converse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: spokenText.trim(),
          language: settings.voice.language,
          voiceName: settings.voice.selectedVoice,
          modelId: selectedModelId === 'auto' ? undefined : selectedModelId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Voice turn failed');

      if (data.generatedImageUrl) {
        setVisualStage({
          imageUrl: data.generatedImageUrl,
          prompt: data.generatedImagePrompt || spokenText,
          label: data.actionLabel || 'Voice Visual Stage',
        });
      }

      await onStateRefresh();

      if (data.audioDataUrl) {
        const audio = new Audio(data.audioDataUrl);
        audio.playbackRate = settings.voice.speakingSpeed;
        audioPlayerRef.current = audio;
        setSpeaking(true);
        audio.onended = () => {
          setSpeaking(false);
          if (handsFreeRef.current && !mutedRef.current) {
            void startRecording();
          }
        };
        audio.onerror = () => setSpeaking(false);
        await audio.play().catch(() => setSpeaking(false));
      } else if (handsFreeRef.current && !mutedRef.current) {
        void startRecording();
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setProcessing(false);
    }
  };

  const toggleHandsFree = async () => {
    const next = !handsFreeActive;
    setHandsFreeActive(next);
    await onUpdateSettings({
      voice: {
        ...settings.voice,
        continuousHandsFree: next,
        vadEnabled: next,
        pushToTalk: !next,
      },
    });
    if (next && !recording && !processing) {
      void startRecording();
    } else if (!next && recording) {
      stopRecording();
    }
  };

  const activeBars = Array.from({ length: 14 }, (_, idx) => {
    const centerBias = 1 - Math.abs(idx - 6.5) / 7;
    const base = recording ? Math.max(12, micLevel * centerBias) : speaking ? 44 * centerBias + 14 : 8;
    return Math.min(100, Math.round(base));
  });

  const quickCommands = pcPolicy.allowed
    ? [
        'Move mouse to 500, 320',
        'Type "Pebble voice test"',
        'Check VRAM and loaded models status',
        'Generate an image of a quiet alpine steel studio',
      ]
    : [
        'Generate an image of a neon mountain ridge',
        'Explain optical glass refraction briefly',
      ];

  return (
    <div className="max-w-[1260px] mx-auto px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--pebble-panel-border)] pb-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">
            Pebble True Voice Mode
          </h1>
          <p className="text-xs text-[var(--pebble-text-secondary)] mt-1">
            Continuous hands-free voice workspace with VAD auto-listen, inline visuals, and PC mouse/keyboard voice commands.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {chatVoiceModels.length > 0 && (
            <select
              aria-label="Voice model selector"
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
              className="px-3 py-2 rounded-xl pebble-glass-subtle text-xs font-medium max-w-[230px]"
            >
              <option value="auto">Auto via Router ({settings.activeRouterId})</option>
              {chatVoiceModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.censorship === 'uncensored' ? 'Uncensored — No PC' : 'Censored'})
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() => void toggleHandsFree()}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap ${
              handsFreeActive
                ? 'pebble-accent-btn border-transparent'
                : 'pebble-glass-subtle'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>{handsFreeActive ? 'Hands-Free: On' : 'Push-to-Talk'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const next = !muted;
              setMuted(next);
              if (next && recording) stopRecording();
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium whitespace-nowrap ${
              muted
                ? 'border-red-500/40 bg-red-500/15 text-red-600 dark:text-red-300'
                : 'pebble-glass-subtle'
            }`}
          >
            {muted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            <span>{muted ? 'Muted' : 'Mic Armed'}</span>
          </button>

          {speaking && (
            <button
              type="button"
              onClick={stopSpeaking}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold whitespace-nowrap"
            >
              <VolumeX className="w-3.5 h-3.5" />
              <span>Stop Speaking</span>
            </button>
          )}
        </div>
      </div>

      {/* PC Control Security Policy Indicator */}
      <div
        className={`rounded-2xl p-3.5 border flex items-center justify-between gap-3 text-xs ${
          pcPolicy.allowed
            ? 'border-emerald-600/30 bg-emerald-700/10 text-emerald-800 dark:text-emerald-200'
            : 'border-amber-600/35 bg-amber-600/15 text-amber-800 dark:text-amber-200'
        }`}
      >
        <div className="flex items-center gap-2">
          {pcPolicy.allowed ? (
            <ShieldCheck className="w-4 h-4 shrink-0" />
          ) : (
            <Lock className="w-4 h-4 shrink-0" />
          )}
          <span>{pcPolicy.reason}</span>
        </div>
        {pcPolicy.allowed && (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] shrink-0">
            <MousePointer2 className="w-3.5 h-3.5" />
            <span>Mouse &amp; Keyboard Ready</span>
          </span>
        )}
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/15 text-xs text-amber-800 dark:text-amber-300">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Acoustic HUD & Quick Commands */}
        <div className="lg:col-span-5 space-y-5">
          <div className="rounded-2xl pebble-glass p-6 space-y-5">
            <div className="flex items-center justify-between text-xs font-mono text-[var(--pebble-text-secondary)]">
              <span>{hardware.isGpuAccelerated ? hardware.gpuName : 'Whisper + Kokoro CPU RAM'}</span>
              <span>{recording ? "I'm listening" : speaking ? 'Speaking' : processing ? 'Routing' : 'Standby'}</span>
            </div>

            <div className="flex flex-col items-center justify-center py-4 space-y-4">
              <button
                type="button"
                disabled={muted || processing}
                onClick={recording ? stopRecording : startRecording}
                className={`w-28 h-28 rounded-full flex flex-col items-center justify-center gap-1.5 border transition-all ${
                  recording
                    ? 'pebble-accent-btn border-emerald-400 scale-105 shadow-lg'
                    : speaking
                      ? 'bg-emerald-900/30 border-emerald-500 text-emerald-300'
                      : 'pebble-glass-subtle hover:border-[var(--pebble-accent)]'
                }`}
                aria-label={recording ? 'Stop listening' : 'Activate voice channel'}
              >
                {recording ? (
                  <Square className="w-6 h-6" />
                ) : (
                  <Activity className="w-7 h-7 text-[var(--pebble-accent)]" />
                )}
                <span className="text-[11px] font-medium">
                  {recording ? "I'm listening" : speaking ? 'Interrupt' : processing ? 'Routing' : 'Speak'}
                </span>
              </button>

              {/* Frequency Waveform Spectrum */}
              <div className="flex items-end justify-center gap-1.5 h-10 w-full max-w-[240px]" aria-hidden="true">
                {activeBars.map((h, i) => (
                  <div
                    key={i}
                    className="w-2 rounded-full bg-emerald-500 transition-all duration-100"
                    style={{ height: `${Math.max(15, h)}%` }}
                  />
                ))}
              </div>
            </div>

            {/* Quick Voice Action Commands */}
            <div className="space-y-2 pt-3 border-t border-[var(--pebble-panel-border)]">
              <div className="text-[11px] font-mono text-[var(--pebble-text-secondary)]">
                Quick Voice Commands
              </div>
              <div className="flex flex-wrap gap-1.5">
                {quickCommands.map((cmd) => (
                  <button
                    key={cmd}
                    type="button"
                    disabled={processing}
                    onClick={() => void runVoiceTurn(cmd)}
                    className="px-2.5 py-1.5 rounded-lg pebble-glass-subtle text-[11px] hover:opacity-85 text-left"
                  >
                    &ldquo;{cmd}&rdquo;
                  </button>
                ))}
              </div>
            </div>

            {/* Voice Parameters */}
            <div className="space-y-3 pt-3 border-t border-[var(--pebble-panel-border)] text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="voice-select" className="block text-[var(--pebble-text-secondary)] mb-1">
                    Voice Profile
                  </label>
                  <select
                    id="voice-select"
                    value={settings.voice.selectedVoice}
                    onChange={(e) =>
                      onUpdateSettings({
                        voice: {
                          ...settings.voice,
                          selectedVoice: e.target.value as PebbleSettings['voice']['selectedVoice'],
                        },
                      })
                    }
                    className="w-full px-2.5 py-2 rounded-lg pebble-glass-subtle"
                  >
                    {['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'].map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="voice-lang" className="block text-[var(--pebble-text-secondary)] mb-1">
                    Language
                  </label>
                  <select
                    id="voice-lang"
                    value={settings.voice.language}
                    onChange={(e) =>
                      onUpdateSettings({
                        voice: { ...settings.voice, language: e.target.value },
                      })
                    }
                    className="w-full px-2.5 py-2 rounded-lg pebble-glass-subtle"
                  >
                    <option value="en-US">English (US)</option>
                    <option value="en-GB">English (UK)</option>
                    <option value="es-ES">Spanish</option>
                    <option value="fr-FR">French</option>
                    <option value="de-DE">German</option>
                    <option value="ja-JP">Japanese</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="speed-slider" className="block text-[var(--pebble-text-secondary)] mb-1 tabular-nums">
                  Speaking Speed: {settings.voice.speakingSpeed.toFixed(2)}x
                </label>
                <input
                  id="speed-slider"
                  type="range"
                  min={0.75}
                  max={1.5}
                  step={0.05}
                  value={settings.voice.speakingSpeed}
                  onChange={(e) =>
                    onUpdateSettings({
                      voice: { ...settings.voice, speakingSpeed: Number(e.target.value) },
                    })
                  }
                  className="w-full accent-emerald-700"
                />
              </div>

              {audioInputs.length > 0 && (
                <div>
                  <label htmlFor="mic-device" className="block text-[var(--pebble-text-secondary)] mb-1">
                    Microphone Input
                  </label>
                  <select
                    id="mic-device"
                    value={selectedMicId}
                    onChange={(e) => setSelectedMicId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg pebble-glass-subtle"
                  >
                    <option value="">System Default Microphone</option>
                    {audioInputs.map((d, idx) => (
                      <option key={d.deviceId || idx} value={d.deviceId}>
                        {d.label || `Microphone ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Visual Display Stage + Spoken Transcript */}
        <div className="lg:col-span-7 space-y-5">
          <div className="rounded-2xl pebble-glass p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-[var(--pebble-accent)]" />
                <span>Voice Visual Stage</span>
              </h2>
              {visualStage && (
                <span className="text-[11px] font-mono text-[var(--pebble-accent)]">
                  {visualStage.label}
                </span>
              )}
            </div>

            {visualStage ? (
              <div className="flex flex-col sm:flex-row items-start gap-4">
                <div className="rounded-xl overflow-hidden border border-[var(--pebble-panel-border)] bg-neutral-950 w-full sm:w-56 shrink-0">
                  <img
                    src={visualStage.imageUrl}
                    alt={visualStage.prompt}
                    referrerPolicy="no-referrer"
                    className="w-full h-36 object-cover"
                  />
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="font-medium">Rendered Output</div>
                  <p className="text-[var(--pebble-text-secondary)] line-clamp-3">
                    {visualStage.prompt}
                  </p>
                </div>
              </div>
            ) : (
              <div className="py-4 text-xs text-[var(--pebble-text-secondary)]">
                Ask Pebble Voice to generate or show an image and it renders directly onto this visual stage.
              </div>
            )}
          </div>

          <div className="rounded-2xl pebble-glass p-5 flex flex-col h-[470px]">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--pebble-panel-border)]">
              <h2 className="font-display text-sm font-semibold">
                Spoken Session Transcript
              </h2>
              <span className="text-xs font-mono text-[var(--pebble-text-secondary)] tabular-nums">
                {voiceHistory.length} turns
              </span>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-3">
              {voiceHistory.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-[var(--pebble-text-secondary)] space-y-2">
                  <Volume2 className="w-7 h-7 opacity-40" />
                  <p className="text-sm max-w-sm">
                    Speak naturally or send a command below. Hands-free mode listens, routes requests, triggers PC mouse/keyboard commands (censored models only), and renders visuals.
                  </p>
                </div>
              ) : (
                voiceHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className={`p-3.5 rounded-xl text-sm space-y-2 ${
                      entry.role === 'user'
                        ? 'bg-emerald-700/20 ml-10'
                        : 'pebble-glass-subtle mr-10'
                    }`}
                  >
                    <div className="text-[11px] font-mono text-[var(--pebble-text-secondary)]">
                      {entry.role === 'user' ? 'You' : entry.modelName || 'Pebble Voice'}
                      {entry.actionLabel ? ` · ${entry.actionLabel}` : ''}
                      {` · ${entry.language}`}
                    </div>
                    <p>{entry.text}</p>
                    {entry.pcActionResult && (
                      <div className="text-xs font-mono px-2.5 py-1.5 rounded-lg bg-black/20 border border-[var(--pebble-panel-border)]">
                        {entry.pcActionResult}
                      </div>
                    )}
                    {entry.generatedImageUrl && (
                      <img
                        src={entry.generatedImageUrl}
                        alt={entry.generatedImagePrompt || 'Voice generated output'}
                        referrerPolicy="no-referrer"
                        className="max-w-xs rounded-lg border border-white/10"
                      />
                    )}
                  </div>
                ))
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const t = manualText;
                setManualText('');
                void runVoiceTurn(t);
              }}
              className="pt-3 border-t border-[var(--pebble-panel-border)] flex items-center gap-2"
            >
              <label htmlFor="voice-text-input" className="sr-only">
                Type a voice command or spoken message
              </label>
              <input
                id="voice-text-input"
                type="text"
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder="Speak aloud or send a voice command (e.g. 'Move mouse to 500, 320' or 'Generate an image')..."
                className="flex-1 px-3.5 py-2 rounded-xl pebble-glass-subtle text-sm"
              />
              <button
                type="submit"
                disabled={processing || !manualText.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl pebble-accent-btn disabled:opacity-50 text-xs font-semibold whitespace-nowrap"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Speak Turn</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const str = String(reader.result);
      resolve(str.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
