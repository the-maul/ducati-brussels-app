/**
 * useFormDraft — un formulaire garde sa saisie en cours dans l'onglet (UX011). Logique pure
 * et registre : `form-draft.ts`.
 *
 * Usage (un seul bloc apres les `useState` du formulaire) :
 *
 *   const draft = useFormDraft({
 *     key: draftKey,                      // null = desactive (edition d'une fiche existante)
 *     value: { contact, lines, ... },     // ce qu'il faut retrouver (serialisable)
 *     restore: (d) => { setContact(d.contact); setLines(d.lines); },
 *     fingerprint: (v) => ({ ...v, contact: v.contact?.id ?? null }), // facultatif
 *   });
 *   {draft.restored && <FormDraftBanner onDiscard={...} />}
 *
 * - au montage : brouillon trouve (et accepte par `accept`) → `restore` une fois ;
 * - ensuite : chaque changement est ecrit ; revenu a l'etat d'ouverture → brouillon efface ;
 * - modifie = garde de sortie (`useLeaveGuard`) : le bouton Retour demande confirmation et,
 *   si l'on quitte, le brouillon est abandonne (`discardActiveDrafts`).
 * `fingerprint` sert a comparer a l'etat d'ouverture sans compter ce qui se charge tout seul
 * (fiche client prechargee par son id, type de document par defaut de la societe...).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { clearFormDraft, isDraftSuspended, readDraft, registerDraft, removeDraft, writeDraft } from './form-draft';
import { useLeaveGuard } from './use-dirty';

export type FormDraftOptions<T> = {
  key: string | null | undefined;
  value: T;
  restore: (draft: T) => void;
  accept?: (draft: T) => boolean;
  fingerprint?: (value: T) => unknown;
};

export type FormDraftHandle = {
  /** Une saisie precedente a ete restauree a l'ouverture. */
  restored: boolean;
  /** Modifie depuis l'ouverture (ou restaure). */
  dirty: boolean;
  /** Abandon : efface le brouillon (l'appelant remet son formulaire a zero). */
  discard: () => void;
  /** Enregistre : efface le brouillon. */
  clear: () => void;
};

export function useFormDraft<T>({ key, value, restore, accept, fingerprint }: FormDraftOptions<T>): FormDraftHandle {
  const fp = JSON.stringify(fingerprint ? fingerprint(value) : value);
  const serialized = JSON.stringify(value);
  const baseline = useRef<string | null>(null);
  if (baseline.current === null) baseline.current = fp;
  const loadedKey = useRef<string | null>(null);
  const [restored, setRestored] = useState(false);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const acceptRef = useRef(accept);
  acceptRef.current = accept;
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (!key) return;
    return registerDraft(key);
  }, [key]);

  useEffect(() => {
    if (!key) return;
    if (loadedKey.current !== key) {
      // Premier passage pour cette cle : on relit, on n'ecrit pas (l'etat n'est pas encore restaure).
      loadedKey.current = key;
      const d = readDraft<T>(key);
      if (d != null) {
        let ok = true;
        try { ok = acceptRef.current ? acceptRef.current(d) : true; } catch { ok = false; }
        if (ok) {
          restoreRef.current(d);
          setRestored(true);
        } else removeDraft(key);
      }
      return;
    }
    if (isDraftSuspended(key)) return;
    if (fp === baseline.current) removeDraft(key);
    else writeDraft(key, valueRef.current);
  }, [key, fp, serialized]);

  const dirty = !!key && fp !== baseline.current;
  useLeaveGuard(dirty);

  const clear = useCallback(() => { if (key) clearFormDraft(key); }, [key]);
  const discard = useCallback(() => {
    if (key) clearFormDraft(key);
    setRestored(false);
  }, [key]);

  return { restored, dirty, discard, clear };
}
