/**
 * M8 — Parcours d'entretien : noter une observation, signaler une pièce à remplacer, prendre une photo.
 * Les pièces alimentent les lignes de l'OR (à 0 €, le comptoir met le prix) ; les photos sont
 * réduites avant enregistrement pour tenir sur la tablette.
 */
import { useRef, useState } from 'react';
import { Camera, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { Finding, FindingKind } from './types';
import { t } from '@/lib/i18n';

/** Réduit la photo à 1 200 px de large en JPEG : une photo d'atelier reste lisible et légère. */
async function shrink(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('lecture'));
    r.readAsDataURL(file);
  });
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('image'));
      i.src = dataUrl;
    });
    const max = 1200;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return dataUrl;
  }
}

export type NewFinding = Omit<Finding, 'id' | 'at'>;

export function FindingDialog({ kind, operationId, stepNo, onAdd, onClose }: {
  kind: FindingKind | null;
  operationId: string;
  stepNo: number | null;
  onAdd: (f: NewFinding) => void;
  onClose: () => void;
}) {
  const [texte, setTexte] = useState('');
  const [reference, setReference] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [photo, setPhoto] = useState<{ name: string; data: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setTexte(''); setReference(''); setQuantity('1'); setPhoto(null); setBusy(false); };
  const close = () => { reset(); onClose(); };

  const canAdd = kind === 'photo' ? !!photo : texte.trim().length > 0;
  const titles: Record<FindingKind, string> = {
    observation: t('journey.noteTitle'), piece: t('journey.partTitle'), photo: t('journey.photoTitle'),
  };

  const submit = () => {
    if (!kind || !canAdd) return;
    const q = Number(String(quantity).replace(',', '.'));
    onAdd({
      kind, operationId, stepNo,
      texte: texte.trim(),
      reference: kind === 'piece' ? reference.trim() || null : null,
      quantity: kind === 'piece' ? (Number.isFinite(q) && q > 0 ? q : 1) : null,
      photoName: photo?.name ?? null,
      photoData: photo?.data ?? null,
    });
    close();
  };

  return (
    <Dialog open={!!kind} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{kind ? titles[kind] : ''}</DialogTitle>
          {stepNo != null && <DialogDescription>{t('journey.step').replace('{n}', String(stepNo))}</DialogDescription>}
        </DialogHeader>

        <div className="space-y-3">
          {kind === 'piece' && (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="jf-ref">{t('journey.partRef')}</Label>
                <Input id="jf-ref" value={reference} onChange={(e) => setReference(e.target.value)} className="h-12 font-mono text-[15px]" inputMode="text" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="jf-qty">{t('journey.partQty')}</Label>
                <Input id="jf-qty" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-12 text-right text-[15px] tabular-nums" inputMode="decimal" />
              </div>
            </div>
          )}

          {kind === 'photo' && (
            <div className="space-y-2">
              <input
                ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setBusy(true);
                  setPhoto({ name: f.name, data: await shrink(f) });
                  setBusy(false);
                }}
              />
              <Button type="button" variant="outline" className="h-14 w-full text-[15px]" onClick={() => fileRef.current?.click()} disabled={busy}>
                <Camera /> {t('journey.photoPick')}
              </Button>
              {photo && <img src={photo.data} alt={photo.name} className="max-h-56 w-full rounded-md border border-border object-contain" />}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="jf-text">{kind === 'piece' ? t('journey.partDesc') : kind === 'photo' ? t('journey.photoLabel') : t('journey.noteLabel')}</Label>
            <Textarea id="jf-text" value={texte} onChange={(e) => setTexte(e.target.value)} rows={3} className="text-[15px]" />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" className="h-12 flex-1 text-[15px]" onClick={close}>{t('journey.cancel')}</Button>
          <Button className="h-12 flex-1 text-[15px]" onClick={submit} disabled={!canAdd || busy}><Check /> {t('journey.add')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
