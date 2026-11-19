import React, { useEffect, useRef, useState } from 'react';
import {
  FileText,
  Image as ImageIcon,
  ImagePlus,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  Square,
  StepForward,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type {
  ChatAttachment,
  Conversation,
  ModelEntry,
  PebbleSettings,
} from '../core/types';
import { getRouterProfile } from '../core/omni';
import { MarkdownRenderer } from './MarkdownRenderer';

interface ChatViewProps {
  conversations: Conversation[];
  activeConversationId: string;
  onSelectConversation: (id: string) => void;
  models: ModelEntry[];
  settings: PebbleSettings;
  pendingPrompt?: string | null;
  pendingVoiceStart?: boolean;
  onConsumePendingPrompt?: () => void;
  onOpenImageLab?: () => void;
  onStateRefresh: () => Promise<void>;
}

export const ChatView: React.FC<ChatViewProps> = ({
  conversations,
  activeConversationId,
  onSelectConversation,
  models,
  settings,
  pendingPrompt,
  pendingVoiceStart,
  onConsumePendingPrompt,
  onOpenImageLab,
  onStateRefresh,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [routingNotice, setRoutingNotice] = useState<string | null>(null);
  const [showParams, setShowParams] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Built-in Voice Mode inside Chat
  const [voiceModeOpen, setVoiceModeOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceReplyNotice, setVoiceReplyNotice] = useState<string | null>(null);
  const [voiceVisualUrl, setVoiceVisualUrl] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [voiceDraftText, setVoiceDraftText] = useState('');

  const currentStreamIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const activeConv =
    conversations.find((c) => c.id === activeConversationId) ?? conversations[0];
  const activeRouter = getRouterProfile(settings.activeRouterId);

  const chatCapableModels = models.filter((m) =>
    m.supportedTasks.some((t) =>
      ['general_chat', 'coding', 'reasoning', 'vision'].includes(t)
    )
  );

  const filteredConvs = conversations.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.title.toLowerCase().includes(q) ||
      c.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConv?.messages.length, streamingText]);

  useEffect(() => {
    if (pendingVoiceStart) {
      setVoiceModeOpen(true);
      onConsumePendingPrompt?.();
    } else if (pendingPrompt && activeConv && !streaming) {
      const promptToSend = pendingPrompt;
      onConsumePendingPrompt?.();
      void sendPrompt(promptToSend);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt, pendingVoiceStart, activeConv?.id]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioPlayerRef.current?.pause();
    };
  }, []);

  const handleNewConversation = async () => {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Conversation', useOmniRouting: true }),
    });
    const data = await res.json();
    await onStateRefresh();
    if (data.conversation?.id) {
      onSelectConversation(data.conversation.id);
    }
  };

  const handleDeleteConversation = async (id: string) => {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    await onStateRefresh();
  };

  const handleUpdateConversation = async (patch: Partial<Conversation>) => {
    if (!activeConv) return;
    await fetch(`/api/conversations/${activeConv.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    await onStateRefresh();
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const next: ChatAttachment[] = [];
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const dataUrl = await readFileAsDataUrl(file);
        next.push({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          name: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          dataUrl,
        });
      } else {
        const textContent = (await file.text()).slice(0, 18_000);
        next.push({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          name: file.name,
          mimeType: file.type || 'text/plain',
          sizeBytes: file.size,
          textContent,
        });
      }
    }
    setAttachments((prev) => [...prev, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleStop = async () => {
    if (!currentStreamIdRef.current) return;
    await fetch('/api/chat/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamId: currentStreamIdRef.current }),
    });
  };

  const sendPrompt = async (
    text: string,
    options?: { regenerateLast?: boolean; continueLast?: boolean }
  ) => {
    if (!activeConv || streaming) return;
    if (!options?.regenerateLast && !options?.continueLast && !text.trim() && attachments.length === 0) {
      return;
    }

    setErrorMsg(null);
    setStreaming(true);
    setStreamingText('');
    setRoutingNotice(null);

    const streamId = `stream-${Date.now()}`;
    currentStreamIdRef.current = streamId;
    const sentAttachments = [...attachments];
    if (!options?.regenerateLast && !options?.continueLast) {
      setInput('');
      setAttachments([]);
    }

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeConv.id,
          prompt: text,
          attachments: sentAttachments,
          streamId,
          regenerateLast: options?.regenerateLast,
          continueLast: options?.continueLast,
        }),
      });

      if (!response.ok || !response.body) {
        const err = await response.json().catch(() => ({ error: 'Failed to connect to chat stream.' }));
        throw new Error(err.error || 'Chat stream failed.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const block of events) {
          const lines = block.split('\n');
          const eventLine = lines.find((l) => l.startsWith('event: '));
          const dataLine = lines.find((l) => l.startsWith('data: '));
          if (!eventLine || !dataLine) continue;

          const eventName = eventLine.slice(7).trim();
          const payload = JSON.parse(dataLine.slice(6));

          if (eventName === 'routing') {
            setRoutingNotice(
              `${payload.modelName} · ${payload.detectedTask.replace(/_/g, ' ')} · ${payload.backendUsed}`
            );
          } else if (eventName === 'token') {
            setStreamingText((prev) => prev + (payload.text || ''));
          } else if (eventName === 'error') {
            setErrorMsg(payload.error || 'Inference error');
          }
        }
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      currentStreamIdRef.current = null;
      setStreaming(false);
      setStreamingText('');
      await onStateRefresh();
    }
  };

  // --- Built-in Voice Mode inside Chat ---
  const stopVoicePlayback = () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.currentTime = 0;
    }
    setSpeaking(false);
  };

  const runChatVoiceTurn = async (spokenText: string) => {
    if (!spokenText.trim() || voiceProcessing) return;
    setVoiceProcessing(true);
    setErrorMsg(null);
    stopVoicePlayback();
    try {
      const modelIdForVoice = activeConv?.useOmniRouting ? undefined : activeConv?.selectedModelId;
      const res = await fetch('/api/voice/converse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: spokenText.trim(),
          language: settings.voice.language,
          voiceName: settings.voice.selectedVoice,
          modelId: modelIdForVoice,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Voice command failed');
      setVoiceReplyNotice(
        `${data.modelName} (${data.actionLabel || 'Voice'}): ${data.replyText}`
      );
      if (data.generatedImageUrl) {
        setVoiceVisualUrl(data.generatedImageUrl);
      }
      await onStateRefresh();

      if (data.audioDataUrl) {
        const audio = new Audio(data.audioDataUrl);
        audio.playbackRate = settings.voice.speakingSpeed;
        audioPlayerRef.current = audio;
        setSpeaking(true);
        audio.onended = () => setSpeaking(false);
        audio.onerror = () => setSpeaking(false);
        await audio.play().catch(() => setSpeaking(false));
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setVoiceProcessing(false);
    }
  };

  const startChatVoiceRecording = async () => {
    stopVoicePlayback();
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      const bins = new Uint8Array(analyser.frequencyBinCount);

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
          setVoiceProcessing(true);
          try {
            const base64 = await blobToBase64(blob);
            const trRes = await fetch('/api/voice/transcribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                audioBase64: base64,
                mimeType: blob.type || 'audio/webm',
                language: settings.voice.language,
              }),
            });
            const trData = await trRes.json();
            if (trRes.ok && trData.text?.trim()) {
              setVoiceProcessing(false);
              await runChatVoiceTurn(trData.text.trim());
            } else {
              setVoiceProcessing(false);
            }
          } catch (err) {
            setVoiceProcessing(false);
            setErrorMsg((err as Error).message);
          }
        }
      };

      const loop = () => {
        analyser.getByteFrequencyData(bins);
        const avg = bins.reduce((a, b) => a + b, 0) / bins.length;
        setMicLevel(Math.min(100, Math.round(avg * 1.8)));
        rafRef.current = requestAnimationFrame(loop);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      loop();
    } catch (err) {
      setErrorMsg(
        `Microphone unavailable (${(err as Error).message}). Type a spoken voice command in the inline Voice panel below.`
      );
    }
  };

  const stopChatVoiceRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  };

  return (
    <div className="h-[calc(100vh-3.5rem)] flex overflow-hidden">
      {/* Conversations Drawer */}
      <div className="w-72 border-r border-black/10 dark:border-white/[0.1] pebble-glass-subtle flex flex-col shrink-0 hidden md:flex">
        <div className="p-3.5 border-b border-black/10 dark:border-white/[0.1] space-y-2.5">
          <button
            type="button"
            onClick={handleNewConversation}
            className="pebble-accent-btn w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>New Chat</span>
          </button>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations..."
              aria-label="Search conversations"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-black/10 dark:border-white/12 bg-white/50 dark:bg-black/30 text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredConvs.map((conv) => {
            const isSelected = conv.id === activeConv?.id;
            return (
              <div
                key={conv.id}
                className={`group flex items-center justify-between gap-1 rounded-xl px-2.5 py-2 transition-colors ${
                  isSelected
                    ? 'bg-black/10 dark:bg-white/[0.12] text-neutral-950 dark:text-white font-semibold'
                    : 'text-neutral-700 dark:text-neutral-300 hover:bg-black/5 dark:hover:bg-white/[0.06]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectConversation(conv.id)}
                  className="flex-1 text-left min-w-0"
                >
                  <div className="text-xs font-medium truncate">{conv.title}</div>
                  <div className="text-[11px] opacity-70 font-mono tabular-nums">
                    {conv.messages.length} messages
                  </div>
                </button>
                {conversations.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleDeleteConversation(conv.id)}
                    aria-label={`Delete conversation ${conv.title}`}
                    className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/15 hover:text-red-500 transition-opacity"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Conversation Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat Top Controls */}
        <div className="px-5 py-3 border-b border-black/10 dark:border-white/[0.1] pebble-glass-subtle flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="font-display text-sm font-semibold text-neutral-950 dark:text-white truncate">
              {activeConv?.title || 'Pebble Chat'}
            </h2>
            {routingNotice && (
              <span className="text-xs font-mono text-neutral-600 dark:text-neutral-300 truncate">
                {routingNotice}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setVoiceModeOpen((v) => !v)}
              aria-expanded={voiceModeOpen}
              style={
                voiceModeOpen
                  ? { backgroundColor: 'var(--pebble-accent)', color: 'var(--pebble-accent-text)' }
                  : undefined
              }
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                voiceModeOpen
                  ? 'border-transparent'
                  : 'border-black/10 dark:border-white/15 text-neutral-700 dark:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/[0.08]'
              }`}
            >
              <Mic className="w-3.5 h-3.5" />
              <span>{voiceModeOpen ? 'Voice Active' : 'Voice Mode'}</span>
            </button>

            <button
              type="button"
              onClick={() =>
                handleUpdateConversation({ useOmniRouting: !activeConv?.useOmniRouting })
              }
              className="px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/15 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/[0.08] transition-colors whitespace-nowrap"
            >
              {activeRouter.name}: {activeConv?.useOmniRouting ? 'Auto' : 'Manual'}
            </button>

            <select
              aria-label="Select chat model"
              disabled={activeConv?.useOmniRouting}
              value={activeConv?.selectedModelId || 'pebble-chat-normal'}
              onChange={(e) => handleUpdateConversation({ selectedModelId: e.target.value })}
              className="px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/15 bg-white/60 dark:bg-black/35 text-xs text-neutral-900 dark:text-neutral-100 disabled:opacity-50"
            >
              {chatCapableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} {m.censorship === 'uncensored' ? '· Uncensored' : ''}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setShowParams(!showParams)}
              aria-label="Toggle generation parameters"
              className="p-2 rounded-lg border border-black/10 dark:border-white/15 text-neutral-700 dark:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/[0.08]"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Built-in Translucent Floating Voice Panel inside Chat */}
        {voiceModeOpen && (
          <div className="px-5 py-3.5 border-b border-black/10 dark:border-white/[0.1] pebble-glass">
            <div className="max-w-3xl mx-auto flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={voiceProcessing}
                    onClick={recording ? stopChatVoiceRecording : startChatVoiceRecording}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                      recording
                        ? 'bg-red-700 text-white'
                        : 'pebble-accent-btn'
                    }`}
                  >
                    {recording ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                    <span>
                      {recording
                        ? "I'm listening... Stop"
                        : voiceProcessing
                          ? 'Routing voice...'
                          : "Speak ('I'm listening')"}
                    </span>
                  </button>

                  {speaking && (
                    <button
                      type="button"
                      onClick={stopVoicePlayback}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-500/40 text-xs font-medium text-red-600 dark:text-red-300"
                    >
                      <VolumeX className="w-3.5 h-3.5" />
                      <span>Stop Voice</span>
                    </button>
                  )}

                  <div className="flex items-end gap-1 h-5" aria-hidden="true">
                    {[0.4, 0.7, 1, 0.85, 0.55, 0.9, 0.5].map((bias, idx) => (
                      <span
                        key={idx}
                        className="w-1 rounded-full transition-all duration-100"
                        style={{
                          backgroundColor: 'var(--pebble-accent)',
                          height: `${recording ? Math.max(20, Math.round(micLevel * bias)) : speaking ? Math.round(70 * bias) : 22}%`,
                        }}
                      />
                    ))}
                  </div>
                </div>

                <span className="text-[11px] font-mono text-neutral-600 dark:text-neutral-300">
                  Voice: {settings.voice.selectedVoice} · Censored models allow mouse & keyboard commands
                </span>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const cmd = voiceDraftText;
                  setVoiceDraftText('');
                  void runChatVoiceTurn(cmd);
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={voiceDraftText}
                  onChange={(e) => setVoiceDraftText(e.target.value)}
                  placeholder="Speak or type a voice command (e.g., 'Move mouse to 500, 320' or 'Show latest gallery image')..."
                  aria-label="In-chat voice command input"
                  className="flex-1 px-3 py-1.5 rounded-xl border border-black/10 dark:border-white/15 bg-white/60 dark:bg-black/30 text-xs text-neutral-950 dark:text-white"
                />
                <button
                  type="submit"
                  disabled={voiceProcessing || !voiceDraftText.trim()}
                  className="px-3 py-1.5 rounded-xl border border-black/10 dark:border-white/15 text-xs font-medium text-neutral-800 dark:text-neutral-100 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-45 whitespace-nowrap"
                >
                  <Volume2 className="w-3.5 h-3.5 inline mr-1" />
                  Run Voice
                </button>
              </form>

              {(voiceReplyNotice || voiceVisualUrl) && (
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-white/40 dark:bg-black/25 text-xs">
                  {voiceVisualUrl && (
                    <img
                      src={voiceVisualUrl}
                      alt="Voice stage render"
                      referrerPolicy="no-referrer"
                      className="w-16 h-16 rounded-lg object-cover shrink-0"
                    />
                  )}
                  <p className="text-neutral-800 dark:text-neutral-200 flex-1">{voiceReplyNotice}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {showParams && activeConv && (
          <div className="px-5 py-3.5 border-b border-black/10 dark:border-white/[0.1] pebble-glass-subtle grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label
                htmlFor="system-instruction-input"
                className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1"
              >
                Custom System Instruction
              </label>
              <input
                id="system-instruction-input"
                type="text"
                value={activeConv.systemInstruction}
                onChange={(e) => handleUpdateConversation({ systemInstruction: e.target.value })}
                className="w-full px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/15 bg-white/60 dark:bg-black/35 text-xs text-neutral-900 dark:text-neutral-100"
              />
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label
                  htmlFor="temp-slider"
                  className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1 tabular-nums"
                >
                  Temperature: {activeConv.temperature}
                </label>
                <input
                  id="temp-slider"
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.1}
                  value={activeConv.temperature}
                  onChange={(e) =>
                    handleUpdateConversation({ temperature: Number(e.target.value) })
                  }
                  className="w-full"
                  style={{ accentColor: 'var(--pebble-accent)' }}
                />
              </div>
              <div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400">Policy</div>
                <div className="text-xs font-mono text-neutral-900 dark:text-neutral-100">
                  {settings.omniMode}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Messages Feed */}
        <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {activeConv?.messages.length === 0 && !streaming && (
              <div className="py-16 text-center space-y-2">
                <h3 className="font-display text-lg font-semibold text-neutral-950 dark:text-white">
                  Start a Conversation
                </h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-300 max-w-md mx-auto">
                  Ask questions, toggle Voice Mode right above, or ask to sketch a quick draft image (full high-res renders live in Image Lab).
                </p>
              </div>
            )}

            {activeConv?.messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.role === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div
                  style={
                    msg.role === 'user'
                      ? {
                          backgroundColor: 'var(--pebble-accent)',
                          color: 'var(--pebble-accent-text)',
                        }
                      : undefined
                  }
                  className={`max-w-[88%] rounded-2xl px-4 py-3 ${
                    msg.role === 'user'
                      ? 'shadow-md'
                      : 'pebble-glass text-neutral-900 dark:text-neutral-100 shadow-sm'
                  }`}
                >
                  {msg.role === 'assistant' && msg.modelName && (
                    <div className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400 mb-2 flex flex-wrap items-center gap-1.5">
                      <span className="font-medium" style={{ color: 'var(--pebble-accent)' }}>
                        {msg.modelName}
                      </span>
                      {msg.routingTask && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{msg.routingTask.replace(/_/g, ' ')}</span>
                        </>
                      )}
                      {msg.backendUsed && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{msg.backendUsed}</span>
                        </>
                      )}
                    </div>
                  )}

                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2.5">
                      {msg.attachments.map((att) =>
                        att.dataUrl ? (
                          <img
                            key={att.id}
                            src={att.dataUrl}
                            alt={att.name}
                            referrerPolicy="no-referrer"
                            className="max-h-48 rounded-lg border border-white/15 object-cover"
                          />
                        ) : (
                          <div
                            key={att.id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/20 text-xs font-mono"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>{att.name}</span>
                          </div>
                        )
                      )}
                    </div>
                  )}

                  {msg.role === 'user' ? (
                    <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  ) : (
                    <MarkdownRenderer content={msg.content} />
                  )}

                  {msg.generatedImageUrl && (
                    <div className="mt-3 space-y-2">
                      <div className="overflow-hidden rounded-xl border border-black/10 dark:border-white/15">
                        <img
                          src={msg.generatedImageUrl}
                          alt="Chat draft image output"
                          referrerPolicy="no-referrer"
                          className="max-w-md w-full h-auto object-cover"
                        />
                      </div>
                      {onOpenImageLab && (
                        <button
                          type="button"
                          onClick={onOpenImageLab}
                          className="inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
                          style={{ color: 'var(--pebble-accent)' }}
                        >
                          <ImageIcon className="w-3.5 h-3.5" />
                          <span>Refine at full quality in Image Lab</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {streaming && (
              <div className="flex flex-col items-start">
                <div className="max-w-[88%] rounded-2xl px-4 py-3 pebble-glass">
                  <div className="text-[11px] font-mono mb-2" style={{ color: 'var(--pebble-accent)' }}>
                    Generating{routingNotice ? ` · ${routingNotice}` : '...'}
                  </div>
                  {streamingText ? (
                    <MarkdownRenderer content={streamingText} />
                  ) : (
                    <p className="text-sm text-neutral-600 dark:text-neutral-300">
                      Preparing model context...
                    </p>
                  )}
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="p-3.5 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-700 dark:text-red-300">
                {errorMsg}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="px-5 py-4 border-t border-black/10 dark:border-white/[0.1] pebble-glass-subtle">
          <div className="max-w-3xl mx-auto space-y-2.5">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/12 bg-white/50 dark:bg-black/30 text-xs"
                  >
                    {att.mimeType.startsWith('image/') ? (
                      <ImagePlus className="w-3.5 h-3.5" style={{ color: 'var(--pebble-accent)' }} />
                    ) : (
                      <FileText className="w-3.5 h-3.5" style={{ color: 'var(--pebble-accent)' }} />
                    )}
                    <span className="truncate max-w-[160px]">{att.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((prev) => prev.filter((a) => a.id !== att.id))
                      }
                      aria-label={`Remove ${att.name}`}
                      className="hover:text-red-500"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendPrompt(input);
              }}
              className="flex items-end gap-2.5"
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.txt,.md,.py,.ts,.tsx,.js,.json,.csv,.log"
                onChange={handleFilePick}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach file or image"
                className="p-2.5 rounded-xl border border-black/10 dark:border-white/15 text-neutral-700 dark:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/[0.08] transition-colors shrink-0"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              <label htmlFor="chat-composer" className="sr-only">
                Message Pebble AI
              </label>
              <textarea
                id="chat-composer"
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendPrompt(input);
                  }
                }}
                placeholder="Message Pebble AI or ask for a quick draft image... (Shift+Enter for new line)"
                className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl border border-black/10 dark:border-white/15 bg-white/60 dark:bg-black/35 text-sm text-neutral-950 dark:text-white placeholder:text-neutral-500 dark:placeholder:text-neutral-400 focus:outline-none resize-none"
              />

              {streaming ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="submit"
                  className="pebble-accent-btn inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send</span>
                </button>
              )}
            </form>

            {activeConv && activeConv.messages.length > 0 && !streaming && (
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void sendPrompt('', { regenerateLast: true })}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-neutral-600 dark:text-neutral-300 hover:bg-black/5 dark:hover:bg-white/[0.08] whitespace-nowrap"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Regenerate</span>
                </button>
                <button
                  type="button"
                  onClick={() => void sendPrompt('', { continueLast: true })}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-neutral-600 dark:text-neutral-300 hover:bg-black/5 dark:hover:bg-white/[0.08] whitespace-nowrap"
                >
                  <StepForward className="w-3 h-3" />
                  <span>Continue</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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
