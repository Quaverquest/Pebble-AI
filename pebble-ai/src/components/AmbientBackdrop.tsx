import React, { useEffect, useRef } from 'react';
import type { BackgroundAnimationStyle, CustomUiThemeTokens } from '../core/types';

interface AmbientBackdropProps {
  tokens: CustomUiThemeTokens;
  customBackgroundUrl?: string;
  animationStyle: BackgroundAnimationStyle;
}

export const AmbientBackdrop: React.FC<AmbientBackdropProps> = ({
  tokens,
  customBackgroundUrl,
  animationStyle,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (animationStyle !== 'particles' && animationStyle !== 'starfield') {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const count = animationStyle === 'starfield' ? 75 : 38;
    const nodes = Array.from({ length: count }, (_, i) => ({
      x: ((i * 197) % 1000) / 1000,
      y: ((i * 313) % 1000) / 1000,
      r: animationStyle === 'starfield' ? (i % 3) + 0.8 : (i % 4) + 1.5,
      vx: ((i % 7) - 3) * 0.00018,
      vy: animationStyle === 'starfield' ? 0.00024 + (i % 5) * 0.00006 : ((i % 5) - 2) * 0.00014,
      alpha: 0.16 + ((i % 6) * 0.08),
    }));

    const dotRgb = tokens.isDark ? '220, 245, 240' : '30, 80, 120';

    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const n of nodes) {
        n.x = (n.x + n.vx + 1) % 1;
        n.y = (n.y + n.vy + 1) % 1;
        ctx.beginPath();
        ctx.arc(n.x * canvas.width, n.y * canvas.height, n.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${dotRgb}, ${n.alpha})`;
        ctx.fill();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [animationStyle, tokens.isDark]);

  return (
    <div
      className="fixed inset-0 -z-10 overflow-hidden pointer-events-none select-none"
      data-testid="ambient-backdrop"
      data-animation={animationStyle}
      style={{
        background: tokens.backdropGradient,
      }}
    >
      {customBackgroundUrl && (
        <img
          src={customBackgroundUrl}
          alt="Custom workspace wallpaper"
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {customBackgroundUrl && (
        <div
          className="absolute inset-0"
          style={{
            background: tokens.isDark
              ? 'linear-gradient(180deg, rgba(8,14,16,0.34) 0%, rgba(8,14,16,0.56) 100%)'
              : 'linear-gradient(180deg, rgba(244,248,252,0.22) 0%, rgba(235,242,248,0.44) 100%)',
          }}
        />
      )}

      {animationStyle === 'aurora' && (
        <div
          className="absolute -inset-24 animate-pebble-aurora opacity-65"
          style={{
            background: `radial-gradient(circle at 28% 32%, ${tokens.accentColor}44 0%, transparent 50%), radial-gradient(circle at 75% 65%, ${tokens.accentHover}38 0%, transparent 52%)`,
          }}
        />
      )}

      {animationStyle === 'mesh_drift' && (
        <div
          className="absolute -inset-28 animate-pebble-mesh opacity-60"
          style={{
            background: `radial-gradient(ellipse at 20% 80%, ${tokens.accentColor}33 0%, transparent 54%), radial-gradient(ellipse at 82% 20%, ${tokens.accentHover}33 0%, transparent 48%)`,
          }}
        />
      )}

      <canvas
        ref={canvasRef}
        className={`absolute inset-0 w-full h-full ${
          animationStyle === 'particles' || animationStyle === 'starfield' ? 'block' : 'hidden'
        }`}
      />
    </div>
  );
};
