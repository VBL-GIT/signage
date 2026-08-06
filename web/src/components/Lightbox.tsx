import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { parseStrokes } from '../lib/distance';

interface ZoomTarget {
  uri: string;
  annotation?: string | null;
  markerX?: number | null;
  markerY?: number | null;
  alt?: string;
}

interface LightboxCtx {
  open: (target: ZoomTarget) => void;
}

const Ctx = createContext<LightboxCtx | null>(null);

export function useLightbox(): LightboxCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLightbox must be used within LightboxProvider');
  return ctx;
}

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/** The enlarged image with wheel-zoom, drag-pan and double-click toggle. */
function ZoomableImage({ target, onClose }: { target: ZoomTarget; onClose: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ startX: number; startY: number; ox: number; oy: number; moved: boolean } | null>(null);
  const strokes = parseStrokes(target.annotation);

  // Reset transform whenever a new image opens.
  useEffect(() => { setT({ scale: 1, x: 0, y: 0 }); }, [target]);

  // Native wheel listener so we can preventDefault (React's onWheel is passive).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const cx = e.clientX - (rect.left + rect.width / 2);
      const cy = e.clientY - (rect.top + rect.height / 2);
      setT((prev) => {
        const next = clamp(prev.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), MIN_SCALE, MAX_SCALE);
        if (next === MIN_SCALE) return { scale: 1, x: 0, y: 0 };
        // Keep the point under the cursor fixed while scaling.
        const ratio = next / prev.scale;
        return { scale: next, x: cx - (cx - prev.x) * ratio, y: cy - (cy - prev.y) * ratio };
      });
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, ox: t.x, oy: t.y, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.current.moved = true;
    if (t.scale === 1) return; // nothing to pan at fit-to-screen
    setT((prev) => ({ ...prev, x: drag.current!.ox + dx, y: drag.current!.oy + dy }));
  }
  function onPointerUp(e: React.PointerEvent) {
    const wasClick = drag.current && !drag.current.moved;
    drag.current = null;
    // A clean click (no drag) at fit-to-screen closes the lightbox.
    if (wasClick && t.scale === 1) onClose();
    e.stopPropagation();
  }
  function onDoubleClick() {
    setT((prev) => (prev.scale === 1 ? { scale: 2.5, x: 0, y: 0 } : { scale: 1, x: 0, y: 0 }));
  }

  return (
    <div
      ref={wrapRef}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      style={{
        position: 'relative', display: 'inline-block', maxWidth: '92vw', maxHeight: '92vh',
        cursor: t.scale === 1 ? 'zoom-in' : 'grab', touchAction: 'none',
      }}
    >
      <div style={{
        transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})`,
        transformOrigin: 'center center', transition: drag.current ? 'none' : 'transform 0.08s ease-out',
        position: 'relative', display: 'inline-block',
      }}>
        <img
          src={target.uri}
          alt={target.alt ?? ''}
          draggable={false}
          style={{ display: 'block', maxWidth: '92vw', maxHeight: '92vh', width: 'auto', height: 'auto', borderRadius: 6, userSelect: 'none' }}
        />
        {strokes && (
          <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            {strokes.map((s, i) => (
              <polyline
                key={i}
                points={s.points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#c62828"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        )}
        {!strokes && target.markerX != null && target.markerY != null && (
          <div style={{
            position: 'absolute', left: `${target.markerX * 100}%`, top: `${target.markerY * 100}%`,
            width: 16, height: 16, marginLeft: -8, marginTop: -8, borderRadius: 8,
            background: '#c62828', border: '2px solid #fff', pointerEvents: 'none',
          }} />
        )}
      </div>
    </div>
  );
}

export function LightboxProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<ZoomTarget | null>(null);
  const open = useCallback((t: ZoomTarget) => setTarget(t), []);
  const close = useCallback(() => setTarget(null), []);

  useEffect(() => {
    if (!target) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [target, close]);

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {target && (
        <div
          onClick={close}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          }}
        >
          <button
            onClick={close}
            aria-label="Close"
            style={{
              position: 'absolute', top: 16, right: 20, width: 40, height: 40, borderRadius: 20,
              border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 22,
              cursor: 'pointer', lineHeight: '40px', textAlign: 'center', padding: 0, zIndex: 1,
            }}
          >
            ×
          </button>
          <div style={{
            position: 'absolute', bottom: 16, left: 0, right: 0, textAlign: 'center',
            color: 'rgba(255,255,255,0.6)', fontSize: 12, pointerEvents: 'none',
          }}>
            Scroll to zoom · drag to pan · double-click to reset
          </div>
          <ZoomableImage target={target} onClose={close} />
        </div>
      )}
    </Ctx.Provider>
  );
}
