import { parseStrokes } from '../lib/distance';
import { useLightbox } from './Lightbox';

interface Props {
  uri: string;
  annotation?: string | null;
  markerX?: number | null;
  markerY?: number | null;
  size?: number;
}

/** Photo with freehand annotation (or legacy dot) overlaid, drawn in a 0..1 viewBox. Click to zoom. */
export function AnnotatedImage({ uri, annotation, markerX, markerY, size = 130 }: Props) {
  const strokes = parseStrokes(annotation);
  const { open } = useLightbox();
  return (
    <div
      onClick={() => open({ uri, annotation, markerX, markerY })}
      role="button"
      aria-label="Zoom photo"
      style={{ position: 'relative', width: size, height: size, borderRadius: 10, overflow: 'hidden', background: '#eee', flex: '0 0 auto', cursor: 'zoom-in' }}
    >
      <img src={uri} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      {strokes && (
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
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
      {!strokes && markerX != null && markerY != null && (
        <div style={{
          position: 'absolute', left: `${markerX * 100}%`, top: `${markerY * 100}%`,
          width: 12, height: 12, marginLeft: -6, marginTop: -6, borderRadius: 6,
          background: '#c62828', border: '2px solid #fff',
        }} />
      )}
    </div>
  );
}
