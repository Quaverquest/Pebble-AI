import React, { useEffect, useState } from 'react';
import {
  Copy,
  ExternalLink,
  RefreshCw,
  Shield,
  Smartphone,
  Trash2,
  Wifi,
} from 'lucide-react';
import type { PebbleSettings, QueuedModelTask, RemoteDevice } from '../core/types';

interface RemoteViewProps {
  settings: PebbleSettings;
  remoteDevices: RemoteDevice[];
  queue: QueuedModelTask[];
  embedded?: boolean;
  onUpdateSettings: (patch: Partial<PebbleSettings>) => Promise<void>;
  onStateRefresh: () => Promise<void>;
}

interface QrPayload {
  primaryUrl: string;
  endpoints: Array<{ name: string; address: string; port: number; url: string; remoteClientUrl: string }>;
  qrDataUrl: string;
  pin: string;
  remoteEnabled: boolean;
}

export const RemoteView: React.FC<RemoteViewProps> = ({
  settings,
  remoteDevices,
  queue,
  embedded = false,
  onUpdateSettings,
  onStateRefresh,
}) => {
  const [qrInfo, setQrInfo] = useState<QrPayload | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const loadQr = async () => {
    const res = await fetch('/api/remote/qr');
    if (res.ok) {
      setQrInfo(await res.json());
    }
  };

  useEffect(() => {
    void loadQr();
  }, [settings.remoteEnabled, settings.remotePin, settings.remotePort]);

  const regeneratePin = async () => {
    const newPin = String(Math.floor(100000 + Math.random() * 900000));
    await onUpdateSettings({ remotePin: newPin });
  };

  const revokeDevice = async (deviceId: string) => {
    await fetch(`/api/remote/revoke/${deviceId}`, { method: 'POST' });
    await onStateRefresh();
  };

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1600);
    } catch {
      // ignore
    }
  };

  const activeDevices = remoteDevices.filter((d) => !d.revoked);

  return (
    <div className={embedded ? 'space-y-6' : 'max-w-[1220px] mx-auto px-6 py-6 space-y-6'}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--pebble-panel-border)] pb-4">
        <div>
          <h2 className={`font-display font-semibold ${embedded ? 'text-xl' : 'text-2xl'}`}>
            Pebble Remote — Household Wi-Fi Access
          </h2>
          <p className="text-xs text-[var(--pebble-text-secondary)] mt-1">
            Access your host PC&apos;s Chat, Image Lab, and Voice services from any phone or laptop on your local Wi-Fi without copying models.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <a
            href="/remote"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl pebble-glass-subtle hover:opacity-85 text-xs font-medium whitespace-nowrap"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Open Remote Client</span>
          </a>
          <button
            type="button"
            onClick={() => onUpdateSettings({ remoteEnabled: !settings.remoteEnabled })}
            className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap ${
              settings.remoteEnabled
                ? 'pebble-accent-btn'
                : 'pebble-glass-subtle'
            }`}
          >
            {settings.remoteEnabled ? 'Remote Access Enabled' : 'Enable Remote Access'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* QR Pairing & Detected LAN URLs */}
        <div className="lg:col-span-5 rounded-2xl pebble-glass p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold flex items-center gap-2">
              <Wifi className="w-4 h-4 text-[var(--pebble-accent)]" />
              <span>QR Pairing &amp; LAN Address</span>
            </h3>
            <span className="text-xs font-mono text-[var(--pebble-text-secondary)]">LAN-Only</span>
          </div>

          {qrInfo?.qrDataUrl && (
            <div className="flex flex-col items-center gap-3 p-4 rounded-xl pebble-glass-subtle">
              <img
                src={qrInfo.qrDataUrl}
                alt="QR Code for Household Wi-Fi Remote Access"
                className="w-44 h-44 rounded-lg bg-white p-2"
              />
              <div className="text-center space-y-1">
                <div className="text-xs text-[var(--pebble-text-secondary)]">Pairing PIN</div>
                <div className="flex items-center justify-center gap-2">
                  <span className="font-mono text-2xl font-semibold tracking-widest tabular-nums">
                    {settings.remotePin}
                  </span>
                  <button
                    type="button"
                    onClick={() => void regeneratePin()}
                    aria-label="Regenerate pairing PIN"
                    className="p-1.5 rounded-lg pebble-glass-subtle hover:opacity-80"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="text-xs font-medium text-[var(--pebble-text-secondary)]">
              Detected Local Network Addresses
            </div>
            {(qrInfo?.endpoints?.length ? qrInfo.endpoints : [{ name: 'Current Origin', address: window.location.hostname, port: settings.remotePort, url: window.location.origin, remoteClientUrl: `${window.location.origin}/remote` }]).map(
              (ep, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-2 p-2.5 rounded-xl pebble-glass-subtle text-xs font-mono"
                >
                  <div className="min-w-0">
                    <div className="text-[11px] text-[var(--pebble-text-secondary)]">{ep.name}</div>
                    <div className="truncate">
                      {ep.remoteClientUrl}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyUrl(ep.remoteClientUrl)}
                    aria-label={`Copy ${ep.remoteClientUrl}`}
                    className="p-1.5 rounded-lg hover:bg-white/10 shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              )
            )}
            {copiedUrl && (
              <div className="text-xs text-[var(--pebble-accent)]">Copied URL to clipboard.</div>
            )}
          </div>
        </div>

        {/* Paired Devices & Security Policy */}
        <div className="lg:col-span-7 space-y-5">
          <div className="rounded-2xl pebble-glass p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-[var(--pebble-accent)]" />
                <span>Authorized Household Devices ({activeDevices.length})</span>
              </h3>
              <span className="text-xs font-mono text-[var(--pebble-text-secondary)] tabular-nums">
                Active Remote Queue: {queue.filter((q) => q.source === 'remote').length}
              </span>
            </div>

            {activeDevices.length === 0 ? (
              <div className="py-8 text-center text-xs text-[var(--pebble-text-secondary)]">
                No household devices paired yet. Scan the QR code or open <span className="font-mono">/remote</span> and enter PIN <span className="font-mono">{settings.remotePin}</span>.
              </div>
            ) : (
              <div className="divide-y divide-[var(--pebble-panel-border)] text-xs">
                {activeDevices.map((dev) => (
                  <div key={dev.id} className="py-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold">{dev.name}</div>
                      <div className="font-mono text-[var(--pebble-text-secondary)] mt-0.5">
                        {dev.ipAddress} · Paired {new Date(dev.pairedAt).toLocaleTimeString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void revokeDevice(dev.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-500/30 text-red-500 hover:bg-red-500/10"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Revoke</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl pebble-glass p-6 space-y-3">
            <h3 className="font-display text-sm font-semibold flex items-center gap-2">
              <Shield className="w-4 h-4 text-[var(--pebble-accent)]" />
              <span>Network &amp; Resource Safety Guarantees</span>
            </h3>
            <ul className="text-xs text-[var(--pebble-text-secondary)] space-y-1.5">
              <li>• Local-network-only binding by default; router UPnP port forwarding is never configured automatically.</li>
              <li>• Every remote Chat, Image Lab, and Voice request executes on the host PC and shares Omni&apos;s serialized 4GB VRAM queue.</li>
              <li>• Devices authenticate with the pairing PIN and receive a revocable session token (<code className="font-mono">x-pebble-device-id</code>).</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
