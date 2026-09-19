/**
 * QR code en SVG (mission 02, carte 9). Matrice calculée par la librairie `qrcode`
 * (correction d'erreur « M », exigée par EPC069-12), dessinée ici en un seul chemin SVG.
 * Couleurs : tokens de la charte (--ducati-black sur --gray-0), jamais de hex, et toujours
 * noir sur blanc quel que soit le thème, avec la zone de silence de 4 modules.
 */
import { useMemo } from 'react';
import QRCode from 'qrcode';

const QUIET = 4;

export function QrCodeSvg({ value, className, label }: { value: string; className?: string; label: string }) {
  const drawing = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    let d = '';
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // get(ligne, colonne)
        if (qr.modules.get(y, x)) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
      }
    }
    return { d, box: size + QUIET * 2 };
  }, [value]);

  return (
    <svg
      viewBox={`0 0 ${drawing.box} ${drawing.box}`}
      role="img" aria-label={label}
      shapeRendering="crispEdges"
      className={className}
      style={{ background: 'var(--gray-0)' }}
    >
      <rect width={drawing.box} height={drawing.box} style={{ fill: 'var(--gray-0)' }} />
      <path d={drawing.d} style={{ fill: 'var(--ducati-black)' }} />
    </svg>
  );
}
