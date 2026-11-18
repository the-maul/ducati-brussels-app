/**
 * M2 — Rattrapage G8 (18/11/2026) : onglets de la fiche article qui manquaient par rapport à G8.
 *
 *  - Mouvements : ancien / nouveau stock réel et arrêté, période, « uniquement le fournisseur
 *    de l'article » (G8 onglet Mouvements) ;
 *  - Documents de l'article : filtres par type, période, fournisseur ; Rappeler ; Excel
 *    (G8 bouton Documents) ;
 *  - En cours fournisseur (G8 onglet) ;
 *  - Équivalences et équivalences d'équivalences, Ajouter / Supprimer (G8 icône ♻) ;
 *  - Mise en librairie / librairie → article (G8 icône « Mise en librairie »).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import * as XLSX from 'xlsx';
import { BookMarked, BookOpenCheck, Download, ExternalLink, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { useConfirm } from '@/components/confirm-provider';
import { fillVars, t } from '@/lib/i18n';
import { useReadOnly } from '@/lib/auth/read-only-context';
import { searchArticlesLite } from '../subobjects-api';
import {
  DOCUMENT_KINDS, listArticleDocuments, listEquivalents, listMovesDetail, listSupplierOpenOrders,
  setEquivalence, setLibrary, type ArticleDocumentRow, type DocumentKind,
} from './api';
import { Empty, FieldLabel, QueryError, Spinner, Td, Th, dateFr, dateTimeFr, errorText, eur, qty } from './ui';

/* ───────────── Mouvements (ancien / nouveau stock réel et arrêté) ───────────── */
export function MovesDetailTab({ articleId }: { articleId: string }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [supplierOnly, setSupplierOnly] = useState(false);
  const q = useQuery({
    queryKey: ['g8-moves', articleId, from, to, supplierOnly],
    queryFn: () => listMovesDetail(articleId, from || null, to || null, supplierOnly),
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('g8a.moves.hint')}</p>
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3">
        <div className="space-y-1"><FieldLabel>{t('g8a.common.between')}</FieldLabel><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div className="space-y-1"><FieldLabel>{t('g8a.common.and')}</FieldLabel><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={supplierOnly} onCheckedChange={(v) => setSupplierOnly(v === true)} />
          {t('g8a.moves.supplierOnly')}
        </label>
      </div>
      <QueryError error={q.error} />
      {q.isLoading ? <Spinner /> : (q.data?.length ?? 0) === 0 ? (!q.error && <Empty>{t('g8a.moves.empty')}</Empty>) : (
        <div className="overflow-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted">
              <tr>
                <Th>{t('g8a.moves.colDate')}</Th><Th>{t('g8a.moves.colOperation')}</Th>
                <Th className="text-right">{t('g8a.moves.colRealBefore')}</Th><Th className="text-right">{t('g8a.moves.colMove')}</Th><Th className="text-right">{t('g8a.moves.colRealAfter')}</Th>
                <Th className="text-right">{t('g8a.moves.colFrozenBefore')}</Th><Th className="text-right">{t('g8a.moves.colFrozenMove')}</Th><Th className="text-right">{t('g8a.moves.colFrozenAfter')}</Th>
                <Th className="text-right">{t('g8a.moves.colCost')}</Th><Th>{t('g8a.moves.colOperator')}</Th>
              </tr>
            </thead>
            <tbody>
              {q.data!.map((m) => (
                <tr key={m.move_id} className="border-b border-border last:border-0">
                  <Td className="whitespace-nowrap font-mono text-[12px]">{dateTimeFr(m.occurred_at)}</Td>
                  <Td>
                    <span>{m.move_type}{m.is_reservation ? ` (${t('g8a.moves.reservation')})` : ''}</span>
                    <span className="block text-[11px] text-muted-foreground">{[m.origin, m.ref, m.note].filter(Boolean).join(' · ')}</span>
                  </Td>
                  <Td className="text-right tabular-nums">{qty(m.real_before)}</Td>
                  <Td className={`text-right tabular-nums ${m.is_reservation ? 'text-muted-foreground' : m.qty_delta < 0 ? 'text-danger' : 'text-success'}`}>{m.qty_delta > 0 ? '+' : ''}{qty(m.qty_delta)}</Td>
                  <Td className="text-right font-bold tabular-nums">{qty(m.real_after)}</Td>
                  <Td className="text-right tabular-nums text-muted-foreground">{qty(m.frozen_before)}</Td>
                  <Td className="text-right tabular-nums text-muted-foreground">{m.frozen_delta ? qty(m.frozen_delta) : ''}</Td>
                  <Td className="text-right tabular-nums text-muted-foreground">{qty(m.frozen_after)}</Td>
                  <Td className="text-right tabular-nums">{m.unit_cost != null ? eur(m.unit_cost) : '—'}</Td>
                  <Td className="text-muted-foreground">{m.operator_name ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ───────────── Documents de l'article ───────────── */
function exportDocuments(rows: ArticleDocumentRow[], reference: string) {
  const header = [
    t('g8a.docs.colKind'), t('g8a.docs.colNumber'), t('g8a.docs.colDate'), t('g8a.docs.colThird'), t('g8a.docs.colQty'),
    t('g8a.docs.colPrice'), t('g8a.docs.colDiscount'), t('g8a.docs.colTotalHt'), t('g8a.docs.colTotalTtc'), t('g8a.docs.colMargin'), t('g8a.docs.colOperator'),
  ];
  const data = rows.map((r) => [
    t(`g8a.docs.kind_${r.kind}`), r.number ?? '', r.doc_date ?? '', r.third_party ?? '', Number(r.quantity),
    r.unit_price_ht ?? '', r.discount_pct ?? '', r.line_ht ?? '', r.line_ttc ?? '', r.margin ?? '', r.operator_name ?? '',
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...data]), 'Documents');
  XLSX.writeFile(wb, `documents-${reference}.xlsx`);
}

export function ArticleDocumentsTab({ articleId, reference }: { articleId: string; reference: string }) {
  const navigate = useNavigate();
  const [kinds, setKinds] = useState<DocumentKind[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [supplierOnly, setSupplierOnly] = useState(false);
  const q = useQuery({
    queryKey: ['g8-docs', articleId, kinds.join(','), from, to, supplierOnly],
    queryFn: () => listArticleDocuments(articleId, kinds, from || null, to || null, supplierOnly),
  });
  const toggle = (k: DocumentKind) => setKinds((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const rows = q.data ?? [];
  const totals = rows.reduce((s, r) => ({ qty: s.qty + Number(r.quantity || 0), ht: s.ht + Number(r.line_ht || 0) }), { qty: 0, ht: 0 });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3">
        <div className="space-y-1.5">
          <FieldLabel>{t('g8a.docs.types')}</FieldLabel>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            <label className="flex items-center gap-1.5 text-sm">
              <Checkbox checked={kinds.length === 0} onCheckedChange={() => setKinds([])} />{t('g8a.docs.all')}
            </label>
            {DOCUMENT_KINDS.map((k) => (
              <label key={k} className="flex items-center gap-1.5 text-sm">
                <Checkbox checked={kinds.includes(k)} onCheckedChange={() => toggle(k)} />{t(`g8a.docs.kind_${k}`)}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-1"><FieldLabel>{t('g8a.common.between')}</FieldLabel><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div className="space-y-1"><FieldLabel>{t('g8a.common.and')}</FieldLabel><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={supplierOnly} onCheckedChange={(v) => setSupplierOnly(v === true)} />{t('g8a.docs.supplierOnly')}
        </label>
        <Button variant="outline" size="sm" disabled={rows.length === 0} onClick={() => exportDocuments(rows, reference)}>
          <Download /> {t('g8a.common.excel')}
        </Button>
      </div>
      <QueryError error={q.error} />
      {q.isLoading ? <Spinner /> : rows.length === 0 ? (!q.error && <Empty>{t('g8a.docs.empty')}</Empty>) : (
        <div className="overflow-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted">
              <tr>
                <Th>{t('g8a.docs.colKind')}</Th><Th>{t('g8a.docs.colNumber')}</Th><Th>{t('g8a.docs.colDate')}</Th><Th>{t('g8a.docs.colThird')}</Th>
                <Th className="text-right">{t('g8a.docs.colQty')}</Th><Th className="text-right">{t('g8a.docs.colPrice')}</Th><Th className="text-right">{t('g8a.docs.colDiscount')}</Th>
                <Th className="text-right">{t('g8a.docs.colTotalHt')}</Th><Th className="text-right">{t('g8a.docs.colTotalTtc')}</Th><Th className="text-right">{t('g8a.docs.colMargin')}</Th>
                <Th>{t('g8a.docs.colOperator')}</Th><Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.kind}-${r.doc_id ?? r.number}-${i}`} className="border-b border-border last:border-0">
                  <Td>{t(`g8a.docs.kind_${r.kind}`)} <span className="text-[11px] text-muted-foreground">{r.doc_type}</span></Td>
                  <Td className="font-mono text-[12px]">{r.number ?? '—'}</Td>
                  <Td className="whitespace-nowrap">{dateFr(r.doc_date)}</Td>
                  <Td>{r.third_party ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{qty(r.quantity)}</Td>
                  <Td className="text-right tabular-nums">{eur(r.unit_price_ht)}</Td>
                  <Td className="text-right tabular-nums">{r.discount_pct ? `${qty(r.discount_pct)} %` : ''}</Td>
                  <Td className="text-right tabular-nums">{eur(r.line_ht)}</Td>
                  <Td className="text-right tabular-nums">{eur(r.line_ttc)}</Td>
                  <Td className={`text-right tabular-nums ${r.margin != null && r.margin < 0 ? 'text-danger' : ''}`}>{r.margin != null ? eur(r.margin) : ''}</Td>
                  <Td className="text-muted-foreground">{r.operator_name ?? '—'}</Td>
                  <Td className="text-right">
                    {r.route && (
                      <Button size="sm" variant="ghost" title={t('g8a.docs.recall')} onClick={() => navigate({ to: r.route! })}>
                        <ExternalLink className="size-4" />
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted">
              <tr>
                <Td className="font-bold">{fillVars(t('g8a.docs.count'), { n: rows.length })}</Td><Td /><Td /><Td />
                <Td className="text-right font-bold tabular-nums">{qty(totals.qty)}</Td><Td /><Td />
                <Td className="text-right font-bold tabular-nums">{eur(totals.ht)}</Td><Td /><Td /><Td /><Td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/* ───────────── En cours fournisseur ───────────── */
export function SupplierOrdersTab({ articleId }: { articleId: string }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['g8-open-orders', articleId], queryFn: () => listSupplierOpenOrders(articleId) });
  const rows = q.data ?? [];
  const total = rows.reduce((s, r) => s + Number(r.quantity || 0), 0);
  return (
    <div className="space-y-3">
      <QueryError error={q.error} />
      {q.isLoading ? <Spinner /> : rows.length === 0 ? (!q.error && <Empty>{t('g8a.openOrders.empty')}</Empty>) : (
        <div className="overflow-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted">
              <tr>
                <Th>{t('g8a.openOrders.colSupplier')}</Th><Th>{t('g8a.openOrders.colNumber')}</Th><Th>{t('g8a.openOrders.colType')}</Th>
                <Th>{t('g8a.openOrders.colDate')}</Th><Th>{t('g8a.openOrders.colStatus')}</Th><Th className="text-right">{t('g8a.openOrders.colQty')}</Th><Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.doc_id}-${i}`} className="border-b border-border last:border-0">
                  <Td>{r.supplier_name ?? '—'}</Td>
                  <Td className="font-mono text-[12px]">{r.number ?? '—'}</Td>
                  <Td>{t(r.doc_type === 'CMD' ? 'g8a.openOrders.typeCmd' : 'g8a.openOrders.typePartOrder')}</Td>
                  <Td>{dateFr(r.doc_date)}</Td>
                  <Td>{r.status}</Td>
                  <Td className="text-right tabular-nums">{qty(r.quantity)}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" title={t('g8a.docs.recall')} onClick={() => navigate({ to: r.route })}><ExternalLink className="size-4" /></Button>
                  </Td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted">
              <tr><Td className="font-bold">{t('g8a.openOrders.total')}</Td><Td /><Td /><Td /><Td /><Td className="text-right font-bold tabular-nums">{qty(total)}</Td><Td /></tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/* ───────────── Équivalences ───────────── */
type Lite = { id: string; reference: string; designation: string };

function EquivalentPicker({ companyId, onPick }: { companyId: string; onPick: (a: Lite) => void }) {
  const [term, setTerm] = useState('');
  const { data } = useQuery({
    queryKey: ['g8-equiv-pick', companyId, term.trim()],
    queryFn: () => searchArticlesLite(companyId, term.trim()),
    enabled: term.trim().length >= 2,
  });
  return (
    <div className="relative w-full max-w-md">
      <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('g8a.equiv.searchPlaceholder')} />
      {data && data.length > 0 && term.trim().length >= 2 && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
          {data.map((a) => (
            <button key={a.id} type="button" onClick={() => { onPick(a); setTerm(''); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
              <span className="font-mono text-[12px]">{a.reference}</span><span className="truncate">{a.designation}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function EquivalencesTab({ articleId, companyId }: { articleId: string; companyId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const readOnly = useReadOnly();
  const [deep, setDeep] = useState(false);
  const q = useQuery({ queryKey: ['g8-equiv', articleId], queryFn: () => listEquivalents(articleId) });
  const inv = () => qc.invalidateQueries({ queryKey: ['g8-equiv'] });
  const mut = useMutation({
    meta: { success: false },
    mutationFn: ({ other, on }: { other: string; on: boolean }) => setEquivalence(articleId, other, on),
    onSuccess: (_d, v) => { inv(); toast.success(t(v.on ? 'g8a.equiv.added' : 'g8a.equiv.removed')); },
    onError: (e) => toast.error(errorText(e)),
  });
  const rows = (q.data ?? []).filter((r) => deep || r.level === 1);
  const deepCount = (q.data ?? []).filter((r) => r.level > 1).length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('g8a.equiv.hint')}</p>
      <div className="flex flex-wrap items-center gap-4">
        {!readOnly && <EquivalentPicker companyId={companyId} onPick={(a) => { if (a.id !== articleId) mut.mutate({ other: a.id, on: true }); }} />}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={deep} onCheckedChange={(v) => setDeep(v === true)} />
          {fillVars(t('g8a.equiv.deep'), { n: deepCount })}
        </label>
      </div>
      <QueryError error={q.error} />
      {q.isLoading ? <Spinner /> : rows.length === 0 ? (!q.error && <Empty>{t('g8a.equiv.empty')}</Empty>) : (
        <div className="overflow-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted">
              <tr>
                <Th>{t('g8a.equiv.colRef')}</Th><Th>{t('g8a.equiv.colDesignation')}</Th><Th>{t('g8a.equiv.colSupplier')}</Th><Th>{t('g8a.equiv.colBrand')}</Th>
                <Th className="text-right">{t('g8a.equiv.colPa')}</Th><Th className="text-right">{t('g8a.equiv.colPvHt')}</Th><Th className="text-right">{t('g8a.equiv.colPvTtc')}</Th>
                <Th className="text-right">{t('g8a.equiv.colReal')}</Th><Th className="text-right">{t('g8a.equiv.colClientOrder')}</Th><Th className="text-right">{t('g8a.equiv.colSupplierOrder')}</Th><Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.article_id} className="border-b border-border last:border-0 hover:bg-accent">
                  <Td>
                    <button type="button" className="font-mono text-[12px] underline-offset-2 hover:underline" onClick={() => navigate({ to: '/parts/$articleId', params: { articleId: r.article_id } })}>{r.reference}</button>
                    {r.level > 1 && <span className="block text-[11px] text-muted-foreground">{fillVars(t('g8a.equiv.via'), { ref: r.via_reference ?? '' })}</span>}
                  </Td>
                  <Td>{r.designation}</Td>
                  <Td>{r.supplier_name ?? '—'}</Td>
                  <Td>{r.brand ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{eur(r.purchase_price)}</Td>
                  <Td className="text-right tabular-nums">{eur(r.sale_price_ht)}</Td>
                  <Td className="text-right tabular-nums">{eur(r.sale_price_ttc)}</Td>
                  <Td className={`text-right tabular-nums ${Number(r.real_qty) > 0 ? 'text-success' : ''}`}>{qty(r.real_qty)}</Td>
                  <Td className="text-right tabular-nums">{qty(r.reserved_qty)}</Td>
                  <Td className="text-right tabular-nums">{qty(r.supplier_order_qty)}</Td>
                  <Td className="text-right">
                    {r.level === 1 && !readOnly && (
                      <Button size="sm" variant="ghost" title={t('g8a.equiv.remove')} disabled={mut.isPending} onClick={() => mut.mutate({ other: r.article_id, on: false })}>
                        <Trash2 className="size-4 text-danger" />
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ───────────── Mise en librairie / librairie → article ───────────── */
export function LibraryButton({ articleId, isLibrary }: { articleId: string; isLibrary: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const readOnly = useReadOnly();
  const mut = useMutation({
    meta: { success: false },
    mutationFn: () => setLibrary([articleId], !isLibrary),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['article', articleId] });
      qc.invalidateQueries({ queryKey: ['articles'] });
      if (r?.refused_stock) toast.error(t('g8a.library.refusedStock'));
      else toast.success(t(isLibrary ? 'g8a.library.doneOut' : 'g8a.library.doneIn'));
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const ask = async () => {
    const ok = await confirm({
      title: t(isLibrary ? 'g8a.library.outTitle' : 'g8a.library.inTitle'),
      message: t(isLibrary ? 'g8a.library.outConfirm' : 'g8a.library.inConfirm'),
    });
    if (ok) mut.mutate();
  };
  return (
    <Button variant="outline" disabled={readOnly || mut.isPending} onClick={ask}>
      {isLibrary ? <BookOpenCheck /> : <BookMarked />} {t(isLibrary ? 'g8a.library.out' : 'g8a.library.in')}
    </Button>
  );
}

/** Badge « En librairie » de l'en-tête de la fiche (statut = couleur + icône + libellé). */
export function LibraryBadge({ isLibrary }: { isLibrary: boolean }) {
  if (!isLibrary) return null;
  return <StatusBadge tone="info" icon={BookMarked} label={t('g8a.library.badge')} />;
}

