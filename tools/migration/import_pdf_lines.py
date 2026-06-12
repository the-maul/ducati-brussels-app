#!/usr/bin/env python3
"""
M14 — Reprise du DÉTAIL des factures depuis les PDF (Info DB/FACTURE *.pdf) :
extrait les lignes (référence, désignation, quantité, P.U. HT/TTC, remise, montant TTC,
TVA) par position (pdfplumber) et insère document_lines pour les factures sans lignes.
Idempotent (saute les documents déjà détaillés).

Usage :
  $env:SUPABASE_SERVICE_ROLE_KEY = [Environment]::GetEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY","User")
  python tools/migration/import_pdf_lines.py            # DRY-RUN sur 5 PDF
  python tools/migration/import_pdf_lines.py --apply     # tout, insère
  python tools/migration/import_pdf_lines.py --apply --limit 50
"""
import os, sys, re, json, glob, urllib.request
import pdfplumber

REF = "ujmrosbgkvgvwfnuryna"; BASE = f"https://{REF}.supabase.co/rest/v1"
SVC = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
INFO = os.path.join(os.path.dirname(__file__), "..", "..", "Info DB")
if not SVC: sys.exit("SUPABASE_SERVICE_ROLE_KEY manquant")

# Colonnes par position x (calées sur les FACTURE 26xxxxxx.pdf)
COLS = [("ref",0,95),("desig",95,300),("qty",300,362),("pu_ht",362,406),
        ("pu_ttc",406,449),("rem",449,489),("montant",489,549),("tva",549,590)]
def colof(x):
    for name,a,b in COLS:
        if a <= x < b: return name
    return None
def pnum(s):
    s = (s or "").replace(" ","").replace(" ","").replace(",",".")
    try: return float(s)
    except: return None

def parse_pdf(path):
    """Retourne la liste des lignes article {ref,desig,qty,pu_ht,pu_ttc,rem,montant,tva}."""
    out = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
            rows = {}
            for w in words:
                key = round(w["top"]/3.0)  # regroupe par ligne (~3px)
                rows.setdefault(key, []).append(w)
            for _, ws in sorted(rows.items()):
                buckets = {n: [] for n,_,_ in COLS}
                for w in sorted(ws, key=lambda z: z["x0"]):
                    c = colof(w["x0"])
                    if c: buckets[c].append(w["text"])
                qty = pnum("".join(buckets["qty"]))
                mont = pnum("".join(buckets["montant"]))
                ref = "".join(buckets["ref"]).strip()
                # Ligne article = a une quantité, un montant, et une référence (pas une
                # ligne d'en-tête/total/bloc véhicule).
                if qty is None or mont is None or not ref: continue
                if ref.upper() in ("REFERENCE","PAGE","FACTURE"): continue
                desig = " ".join(buckets["desig"]).strip()
                tva = pnum("".join(buckets["tva"])) or 0.0
                out.append({
                    "ref": ref, "desig": desig or ref, "qty": qty,
                    "pu_ht": pnum("".join(buckets["pu_ht"])) or 0.0,
                    "pu_ttc": pnum("".join(buckets["pu_ttc"])) or 0.0,
                    "rem": pnum("".join(buckets["rem"])) or 0.0,
                    "montant": mont, "tva": tva,
                })
    return out

def req(method, path, body=None, prefer=None):
    r = urllib.request.Request(f"{BASE}/{path}", data=(json.dumps(body).encode() if body is not None else None), method=method)
    r.add_header("apikey", SVC); r.add_header("Authorization", f"Bearer {SVC}"); r.add_header("Content-Type","application/json")
    if prefer: r.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read().decode(); return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path} -> {e.code}: {e.read().decode()[:300]}")

def main():
    apply = "--apply" in sys.argv
    limit = None
    if "--limit" in sys.argv: limit = int(sys.argv[sys.argv.index("--limit")+1])
    files = sorted(glob.glob(os.path.join(INFO, "FACTURE *.pdf")))
    if not apply: files = files[:5]
    elif limit: files = files[:limit]
    co = req("GET","companies?select=id,code")
    cid = next((c["id"] for c in co if (c.get("code") or "").lower()=="italbike"), co[0]["id"])
    done=0; lines_total=0; skipped=0; nodoc=0
    for f in files:
        m = re.search(r"(\d{6,})", os.path.basename(f))
        if not m: continue
        num = m.group(1)
        docs = req("GET", f"documents?select=id&company_id=eq.{cid}&legacy_number=eq.{num}")
        if not docs: nodoc += 1; continue
        did = docs[0]["id"]
        existing = req("GET", f"document_lines?select=id&document_id=eq.{did}&limit=1")
        if existing: skipped += 1; continue
        lines = parse_pdf(f)
        if not lines: continue
        rows = []
        for i,l in enumerate(lines):
            line_ttc = round(l["montant"],2)
            vat = l["tva"]
            line_ht = round(line_ttc/(1+vat/100.0),2) if vat else line_ttc
            unit_ht = round(l["pu_ht"],3)
            rows.append({"document_id":did,"reference":l["ref"],"designation":l["desig"][:200],
                         "quantity":l["qty"],"unit_price_ht":unit_ht,"vat_rate":vat,
                         "discount_pct":l["rem"],"line_ht":line_ht,"line_ttc":line_ttc,"sort_order":i})
        if apply:
            req("POST","document_lines",rows,prefer="return=minimal")
        else:
            print(f"[{num}] {len(rows)} lignes:")
            for r in rows[:4]: print("   ", r["reference"], "|", r["desig"][:30] if False else r["designation"][:30], "| q",r["quantity"],"| ttc",r["line_ttc"],"| tva",r["vat_rate"])
        done += 1; lines_total += len(rows)
    print(f"\n{'APPLIQUE' if apply else 'DRY-RUN'} : {done} factures detaillees, {lines_total} lignes, {skipped} deja faites, {nodoc} sans doc en base.")

if __name__ == "__main__": main()
