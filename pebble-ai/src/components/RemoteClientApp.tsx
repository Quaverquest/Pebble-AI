import React, { useEffect, useState } from 'react';
import { Cpu, Image as ImageIcon, MessageSquare, Mic, Send, Wifi } from 'lucide-react';
import type { PebbleStateSnapshot } from '../core/types';
import { MarkdownRenderer } from './MarkdownRenderer';

export const RemoteClientApp: React.FC = () => {
  const [deviceId, setDeviceId] = useState<string | null>(() =>
    localStorage.getItem('pebble_remote_device_id')
  );
  const [deviceName, setDeviceName] = useState('Living Room Phone');
  const [pin, setPin] = useState('');
  const [pairError, setPairError] = useState<string | null>(null);
  const [tab, setTab] = useState<'chat' | 'image' | 'voice' | 'host'>('chat');
  const [state, setState] = useState<PebbleStateSnapshot | null>(null);

  const [chatInput, setChatInput] = useState('');
  const [chatReply, setChatReply] = useState('');
  const [sendingChat, setSendingChat] = useState(false);

  const [imgPrompt, setImgPrompt] = useState('');
  const [generatingImg, setGeneratingImg] = useState(false);
  const [latestImgUrl, setLatestImgUrl] = useState<string | null>(null);

  const [voiceInput, setVoiceInput] = useState('');
  const [voiceReply, setVoiceReply] = useState('');
  const [voiceVisualUrl, setVoiceVisualUrl] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchState = async () => {
    const res = await fetch('/api/state');
    if (res.ok) {
      setState(await res.json());
    }
  };

  useEffect(() => {
    void fetchState();
  }, [deviceId]);

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault();
    setPairError(null);
    const res = await fetch('/api/remote/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pin.trim(), deviceName }),
    });
    const data = await res.json();
    if (!res.ok) {
      setPairError(data.error || 'Pairing failed');
      return;
    }
    localStorage.setItem('pebble_remote_device_id', data.device.id);
    setDeviceId(data.device.id);
  };

  const sendRemoteChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !state || !deviceId || sendingChat) return;
    setSendingChat(true);
    setChatReply('');
    setErrorMsg(null);
    const convId = state.conversations[0]?.id;

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-pebble-device-id': deviceId,
        },
        body: JSON.stringify({
          conversationId: convId,
          prompt: chatInput.trim(),
          source: 'remote',
        }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({ error: 'Remote chat failed' }));
        throw new Error(d.error);
      }
      setChatInput('');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() ?? '';
        for (const ev of events) {
          const lines = ev.split('\n');
          const eLine = lines.find((l) => l.startsWith('event: '));
          const dLine = lines.find((l) => l.startsWith('data: '));
          if (!eLine || !dLine) continue;
          const payload = JSON.parse(dLine.slice(6));
          if (eLine.slice(7).trim() === 'token') {
            setChatReply((p) => p + (payload.text || ''));
          } else if (eLine.slice(7).trim() === 'error') {
            setErrorMsg(payload.error);
          }
        }
      }
      await fetchState();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSendingChat(false);
    }
  };

  const generateRemoteImage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imgPrompt.trim() || !deviceId || generatingImg) return;
    setGeneratingImg(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/images/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-pebble-device-id': deviceId,
        },
        body: JSON.stringify({
          prompt: imgPrompt.trim(),
          modelId: 'pebble-image-normal',
          aspectRatio: '1:1',
          source: 'remote',
          deviceName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Remote image generation failed');
      if (data.images?.[0]) {
        setLatestImgUrl(data.images[0].imageUrl);
      }
      await fetchState();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setGeneratingImg(false);
    }
  };

  const sendRemoteVoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voiceInput.trim() || !deviceId || speaking) return;
    setSpeaking(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/voice/converse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-pebble-device-id': deviceId,
        },
        body: JSON.stringify({
          text: voiceInput.trim(),
          source: 'remote',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Remote voice failed');
      setVoiceInput('');
      setVoiceReply(data.replyText);
      if (data.generatedImageUrl) {
        setVoiceVisualUrl(data.generatedImageUrl);
      }
      if (data.audioDataUrl) {
        const audio = new Audio(data.audioDataUrl);
        await audio.play().catch(() => {});
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSpeaking(false);
    }
  };

  if (!deviceId) {
    return (
      <div className="min-h-screen bg-[#111315] text-neutral-100 flex items-center justify-center p-5">
        <form
          onSubmit={handlePair}
          className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#181B1E] p-6 space-y-4"
        >
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-mono">
            <Wifi className="w-4 h-4" />
            <span>Pebble Remote · Household Wi-Fi</span>
          </div>
          <h1 className="font-display text-xl font-semibold text-white">
            Pair with Host PC
          </h1>
          <p className="text-xs text-neutral-400">
            Enter the 6-digit Pairing PIN shown on the Remote tab of your Pebble AI host computer.
          </p>

          <div>
            <label htmlFor="remote-dev-name" className="block text-xs text-neutral-400 mb-1">
              Device Name
            </label>
            <input
              id="remote-dev-name"
              type="text"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-white/10 bg-[#111315] text-sm text-white"
            />
          </div>

          <div>
            <label htmlFor="remote-pin-input" className="block text-xs text-neutral-400 mb-1">
              6-Digit Pairing PIN
            </label>
            <input
              id="remote-pin-input"
              type="text"
              inputMode="numeric"
              required
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="e.g. 482910"
              className="w-full px-3 py-2 rounded-xl border border-white/10 bg-[#111315] text-base font-mono tracking-widest text-white"
            />
          </div>

          {pairError && <div className="text-xs text-red-400">{pairError}</div>}

          <button
            type="submit"
            className="w-full py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-700 text-white text-sm font-semibold"
          >
            Connect to Host
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#111315] text-neutral-100 flex flex-col max-w-2xl mx-auto">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <div>
          <div className="font-display text-sm font-semibold text-white">Pebble Remote</div>
          <div className="text-[11px] font-mono text-emerald-400">
            Host: {state?.hardware.hostname || 'Connected'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href="/" className="text-xs text-neutral-400 hover:text-white">
            Desktop View
          </a>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem('pebble_remote_device_id');
              setDeviceId(null);
            }}
            className="text-xs text-neutral-400 hover:text-red-400"
          >
            Unpair
          </button>
        </div>
      </header>

      <nav className="grid grid-cols-4 border-b border-white/10 text-xs">
        {(
          [
            { id: 'chat', label: 'Chat', icon: MessageSquare },
            { id: 'image', label: 'Image', icon: ImageIcon },
            { id: 'voice', label: 'Voice', icon: Mic },
            { id: 'host', label: 'Host', icon: Cpu },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`py-3 flex flex-col items-center gap-1 font-medium ${
                tab === item.id ? 'text-emerald-400 border-b-2 border-emerald-500' : 'text-neutral-400'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <main className="flex-1 p-4 space-y-4">
        {errorMsg && (
          <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-300">
            {errorMsg}
          </div>
        )}

        {tab === 'chat' && (
          <div className="space-y-4">
            <form onSubmit={sendRemoteChat} className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask host AI via Omni..."
                aria-label="Remote chat prompt"
                className="flex-1 px-3.5 py-2.5 rounded-xl border border-white/10 bg-[#181B1E] text-sm text-white"
              />
              <button
                type="submit"
                disabled={sendingChat}
                className="px-4 py-2.5 rounded-xl bg-emerald-800 text-white text-xs font-semibold"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
            {chatReply && (
              <div className="p-4 rounded-xl border border-white/10 bg-[#181B1E]">
                <MarkdownRenderer content={chatReply} />
              </div>
            )}
          </div>
        )}

        {tab === 'image' && (
          <div className="space-y-4">
            <p className="text-xs text-neutral-400">
              Requests run on the host PC using Qwen Image 2.1 and are saved to the shared gallery.
            </p>
            <form onSubmit={generateRemoteImage} className="space-y-2.5">
              <textarea
                rows={3}
                value={imgPrompt}
                onChange={(e) => setImgPrompt(e.target.value)}
                placeholder="Describe an image to render on host..."
                aria-label="Remote image prompt"
                className="w-full px-3.5 py-2.5 rounded-xl border border-white/10 bg-[#181B1E] text-sm text-white resize-none"
              />
              <button
                type="submit"
                disabled={generatingImg}
                className="w-full py-2.5 rounded-xl bg-emerald-800 text-white text-xs font-semibold"
              >
                {generatingImg ? 'Generating on Host...' : 'Generate on Host PC'}
              </button>
            </form>
            {latestImgUrl && (
              <img
                src={latestImgUrl}
                alt="Remote generated output"
                referrerPolicy="no-referrer"
                className="w-full rounded-xl border border-white/10"
              />
            )}
          </div>
        )}

        {tab === 'voice' && (
          <div className="space-y-4">
            <form onSubmit={sendRemoteVoice} className="flex gap-2">
              <input
                type="text"
                value={voiceInput}
                onChange={(e) => setVoiceInput(e.target.value)}
                placeholder="Speak or type to Pebble Voice..."
                className="flex-1 px-3.5 py-2.5 rounded-xl border border-white/10 bg-[#181B1E] text-sm text-white"
              />
              <button
                type="submit"
                disabled={speaking}
                className="px-4 py-2.5 rounded-xl bg-emerald-800 text-white text-xs font-semibold"
              >
                {speaking ? '...' : 'Talk'}
              </button>
            </form>
            {voiceReply && (
              <div className="p-4 rounded-xl border border-white/10 bg-[#181B1E] text-sm text-neutral-200 space-y-3">
                <p>{voiceReply}</p>
                {voiceVisualUrl && (
                  <img
                    src={voiceVisualUrl}
                    alt="Voice visual stage"
                    referrerPolicy="no-referrer"
                    className="w-full rounded-lg border border-white/10"
                  />
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'host' && state && (
          <div className="space-y-3 text-xs font-mono tabular-nums">
            <div className="p-4 rounded-xl border border-white/10 bg-[#181B1E] space-y-1.5">
              <div className="text-neutral-400">Host Hardware</div>
              <div className="text-white">{state.hardware.cpuModel}</div>
              <div>CPU Load: {state.hardware.cpuLoadPercent}%</div>
              <div>RAM: {state.hardware.usedRamGb} / {state.hardware.totalRamGb} GB</div>
              <div>VRAM Allocated: {state.hardware.gpuVramUsedGb} GB</div>
              <div>Router: {state.settings.activeRouterId} ({state.settings.omniMode})</div>
              <div>Backend: {state.hardware.amdAcceleration.preferredBackend}</div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
