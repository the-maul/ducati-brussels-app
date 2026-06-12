/**
 * M12 — Domiciliation SEPA (pain.008.001.02) : génère le fichier de prélèvement
 * pour la banque à partir des factures encaissables (clients avec mandat), enregistre
 * l'encaissement, et gère les impayés (remise en dû). Sans dépendance externe.
 */
import { supabase } from '@/integrations/supabase/client';

export type CollectableRow = {
  document_id: string; number: string | null; due_date: string | null; contact_id: string;
  contact_name: string; amount_due: number; mandate_ref: string; iban: string; bic: string | null;
  signature_date: string; seq_type: string;
};

export async function getSepaCollectable(companyId: string, dueTo: string): Promise<CollectableRow[]> {
  const { data, error } = await supabase.rpc('sepa_collectable', { _company: companyId, _due_to: dueTo });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, amount_due: Number(r.amount_due) }));
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const r2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/** Construit le XML SEPA Direct Debit pain.008.001.02 (un PmtInf, schéma CORE). */
export function buildPain008(p: {
  msgId: string; creationDateTime: string; collectionDate: string;
  creditorName: string; creditorIban: string; creditorBic: string | null; creditorId: string;
  rows: CollectableRow[];
}): string {
  const nb = p.rows.length;
  const ctrl = r2(p.rows.reduce((s, r) => s + r.amount_due, 0));
  const seq = p.rows[0]?.seq_type || 'RCUR';
  const tx = p.rows.map((r) => `
      <DrctDbtTxInf>
        <PmtId><EndToEndId>${esc(r.number || r.document_id.slice(0, 8))}</EndToEndId></PmtId>
        <InstdAmt Ccy="EUR">${r2(r.amount_due)}</InstdAmt>
        <DrctDbtTx><MndtRltdInf><MndtId>${esc(r.mandate_ref)}</MndtId><DtOfSgntr>${esc(r.signature_date)}</DtOfSgntr></MndtRltdInf></DrctDbtTx>
        <DbtrAgt><FinInstnId>${r.bic ? `<BIC>${esc(r.bic)}</BIC>` : '<Othr><Id>NOTPROVIDED</Id></Othr>'}</FinInstnId></DbtrAgt>
        <Dbtr><Nm>${esc(r.contact_name)}</Nm></Dbtr>
        <DbtrAcct><Id><IBAN>${esc(r.iban.replace(/\s/g, ''))}</IBAN></Id></DbtrAcct>
        <RmtInf><Ustrd>${esc(r.number || '')}</Ustrd></RmtInf>
      </DrctDbtTxInf>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02">
  <CstmrDrctDbtInitn>
    <GrpHdr>
      <MsgId>${esc(p.msgId)}</MsgId>
      <CreDtTm>${esc(p.creationDateTime)}</CreDtTm>
      <NbOfTxs>${nb}</NbOfTxs>
      <CtrlSum>${ctrl}</CtrlSum>
      <InitgPty><Nm>${esc(p.creditorName)}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${esc(p.msgId)}-1</PmtInfId>
      <PmtMtd>DD</PmtMtd>
      <NbOfTxs>${nb}</NbOfTxs>
      <CtrlSum>${ctrl}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm><Cd>CORE</Cd></LclInstrm><SeqTp>${esc(seq)}</SeqTp></PmtTpInf>
      <ReqdColltnDt>${esc(p.collectionDate)}</ReqdColltnDt>
      <Cdtr><Nm>${esc(p.creditorName)}</Nm></Cdtr>
      <CdtrAcct><Id><IBAN>${esc(p.creditorIban.replace(/\s/g, ''))}</IBAN></Id></CdtrAcct>
      <CdtrAgt><FinInstnId>${p.creditorBic ? `<BIC>${esc(p.creditorBic)}</BIC>` : '<Othr><Id>NOTPROVIDED</Id></Othr>'}</FinInstnId></CdtrAgt>
      <CdtrSchmeId><Id><PrvtId><Othr><Id>${esc(p.creditorId)}</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>${tx}
    </PmtInf>
  </CstmrDrctDbtInitn>
</Document>`;
}

function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

/**
 * Génère le fichier pain.008 pour la remise, le télécharge, et enregistre
 * l'encaissement (règlement 'DOM') sur chaque facture. Retourne le nb de lignes.
 */
export async function generateSepaFile(companyId: string, dueTo: string, collectionDate: string): Promise<number> {
  const rows = await getSepaCollectable(companyId, dueTo);
  if (rows.length === 0) return 0;
  const { data: company } = await supabase.from('companies').select('*').eq('id', companyId).maybeSingle();
  const c = (company ?? {}) as Record<string, unknown>;
  const stamp = collectionDate.replace(/-/g, '');
  const xml = buildPain008({
    msgId: `SDD-${stamp}-${companyId.slice(0, 6)}`,
    creationDateTime: new Date().toISOString().slice(0, 19),
    collectionDate,
    creditorName: String(c.legal_name || c.name || 'Créancier'),
    creditorIban: String(c.iban || ''),
    creditorBic: (c.bic as string) || null,
    creditorId: String(c.sepa_creditor_id || 'BE00ZZZ000000000000'),
    rows,
  });
  download(`SEPA_PAIN008_${stamp}.xml`, xml, 'application/xml;charset=utf-8;');
  // Enregistre l'encaissement par domiciliation sur chaque facture.
  for (const r of rows) {
    await supabase.rpc('record_sepa_collection', { _document: r.document_id, _amount: r.amount_due });
  }
  return rows.length;
}

/** Impayé (rejet bancaire) : remet la facture en dû (règlement négatif, B7). */
export async function recordSepaUnpaid(documentId: string, amount: number): Promise<void> {
  const { error } = await supabase.rpc('record_sepa_unpaid', { _document: documentId, _amount: amount });
  if (error) throw error;
}
