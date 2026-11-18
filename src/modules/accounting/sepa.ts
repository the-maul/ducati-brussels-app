/**
 * M12 — Domiciliation SEPA (pain.008.001.02) : génère le fichier de prélèvement
 * pour la banque à partir des factures encaissables (clients avec mandat), et gère les impayés
 * (remise en dû). Sans dépendance externe.
 *
 * Rattrapage G8 « Encaissements » (18/11/2026, migration 20261118173000) : les REMISES (G8
 * « Nouvelle remise / Remises en attente ou archivées ») remplacent l'ancien `generateSepaFile`,
 * qui partait avec un ICS factice et notait l'encaissement dès la génération du fichier. Une remise
 * est d'abord EN ATTENTE (fichier rangé sur la remise) ; l'encaissement est noté à l'ARCHIVAGE
 * (la banque a prélevé). Voir `sepa-batches.ts`.
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

export function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

/** Impayé (rejet bancaire) : remet la facture en dû (règlement négatif, B7). */
export async function recordSepaUnpaid(documentId: string, amount: number): Promise<void> {
  const { error } = await supabase.rpc('record_sepa_unpaid', { _document: documentId, _amount: amount });
  if (error) throw error;
}

/** Une transaction d'une remise (échéance prélevée). */
export type SepaTx = {
  endToEndId: string; amount: number; mandateRef: string; signatureDate: string; iban: string; bic: string | null;
  debtorName: string; remittance: string; seqType: string;
};

/**
 * pain.008.001.02 d'une remise : un bloc PmtInf PAR TYPE DE SÉQUENCE (FRST, RCUR, OOFF, FNAL),
 * exigence du schéma (le type de séquence est porté par le bloc, pas par la transaction).
 */
export function buildPain008Batch(p: {
  msgId: string; creationDateTime: string; collectionDate: string;
  creditorName: string; creditorIban: string; creditorBic: string | null; creditorId: string;
  txs: SepaTx[];
}): string {
  if (!p.creditorId.trim()) throw new Error('missing_creditor_id');
  if (!p.creditorIban.trim()) throw new Error('missing_creditor_iban');
  const groups = new Map<string, SepaTx[]>();
  for (const tx of p.txs) { const k = tx.seqType || 'RCUR'; groups.set(k, [...(groups.get(k) ?? []), tx]); }
  const sum = (l: SepaTx[]) => r2(l.reduce((s, x) => s + x.amount, 0));
  let i = 0;
  const blocks = [...groups.entries()].map(([seq, list]) => {
    i += 1;
    const tx = list.map((r) => `
      <DrctDbtTxInf>
        <PmtId><EndToEndId>${esc(r.endToEndId.slice(0, 35))}</EndToEndId></PmtId>
        <InstdAmt Ccy="EUR">${r2(r.amount)}</InstdAmt>
        <DrctDbtTx><MndtRltdInf><MndtId>${esc(r.mandateRef)}</MndtId><DtOfSgntr>${esc(r.signatureDate)}</DtOfSgntr></MndtRltdInf></DrctDbtTx>
        <DbtrAgt><FinInstnId>${r.bic ? `<BIC>${esc(r.bic)}</BIC>` : '<Othr><Id>NOTPROVIDED</Id></Othr>'}</FinInstnId></DbtrAgt>
        <Dbtr><Nm>${esc(r.debtorName.slice(0, 70))}</Nm></Dbtr>
        <DbtrAcct><Id><IBAN>${esc(r.iban.replace(/\s/g, ''))}</IBAN></Id></DbtrAcct>
        <RmtInf><Ustrd>${esc(r.remittance.slice(0, 140))}</Ustrd></RmtInf>
      </DrctDbtTxInf>`).join('');
    return `
    <PmtInf>
      <PmtInfId>${esc(p.msgId)}-${i}</PmtInfId>
      <PmtMtd>DD</PmtMtd>
      <NbOfTxs>${list.length}</NbOfTxs>
      <CtrlSum>${sum(list)}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm><Cd>CORE</Cd></LclInstrm><SeqTp>${esc(seq)}</SeqTp></PmtTpInf>
      <ReqdColltnDt>${esc(p.collectionDate)}</ReqdColltnDt>
      <Cdtr><Nm>${esc(p.creditorName)}</Nm></Cdtr>
      <CdtrAcct><Id><IBAN>${esc(p.creditorIban.replace(/\s/g, ''))}</IBAN></Id></CdtrAcct>
      <CdtrAgt><FinInstnId>${p.creditorBic ? `<BIC>${esc(p.creditorBic)}</BIC>` : '<Othr><Id>NOTPROVIDED</Id></Othr>'}</FinInstnId></CdtrAgt>
      <CdtrSchmeId><Id><PrvtId><Othr><Id>${esc(p.creditorId)}</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>${tx}
    </PmtInf>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02">
  <CstmrDrctDbtInitn>
    <GrpHdr>
      <MsgId>${esc(p.msgId)}</MsgId>
      <CreDtTm>${esc(p.creationDateTime)}</CreDtTm>
      <NbOfTxs>${p.txs.length}</NbOfTxs>
      <CtrlSum>${sum(p.txs)}</CtrlSum>
      <InitgPty><Nm>${esc(p.creditorName)}</Nm></InitgPty>
    </GrpHdr>${blocks}
  </CstmrDrctDbtInitn>
</Document>`;
}
