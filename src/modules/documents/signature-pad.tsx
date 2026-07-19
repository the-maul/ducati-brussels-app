/**
 * M9 — Bloc de signature manuscrite (doigt / stylet / souris) sur canvas.
 * Renvoie l'image de la signature en dataURL PNG (fond transparent), ou null
 * tant que rien n'est tracé. Réutilisable (attestations, bons, décharges).
 */
import { useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

const W = 560;
const H = 180;

export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a1a1a'; // encre de la signature (contenu, pas UI)
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  };

  const emit = () => {
    const canvas = canvasRef.current;
    onChange(canvas ? canvas.toDataURL('image/png') : null);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onChange(null);
  };

  return (
    <div className="space-y-1.5">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="w-full touch-none rounded-md border border-border bg-white"
        style={{ touchAction: 'none', aspectRatio: `${W}/${H}` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          last.current = point(e);
        }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return;
          const ctx = canvasRef.current?.getContext('2d');
          if (!ctx) return;
          const p = point(e);
          ctx.beginPath();
          ctx.moveTo(last.current.x, last.current.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          last.current = p;
          if (!hasInk) setHasInk(true);
        }}
        onPointerUp={() => {
          drawing.current = false;
          last.current = null;
          emit();
        }}
      />
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">{t('tradein.signHint')}</p>
        <Button type="button" variant="outline" size="sm" onClick={clear} disabled={!hasInk}>
          <Eraser className="size-3.5" /> {t('tradein.signClear')}
        </Button>
      </div>
    </div>
  );
}
