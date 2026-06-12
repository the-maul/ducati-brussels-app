#!/usr/bin/env python3
"""
M14 — Import des exports G8 (dossier "Info DB") vers Supabase, sur ITALBIKE STORE.
On adapte l'app aux documents : mapping conforme à docs/migration-g8-formats.md.

Usage (PowerShell) :
  $env:SUPABASE_SERVICE_ROLE_KEY = [Environment]::GetEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY","User")
  python tools/migration/import_g8.py fournisseurs            # DRY-RUN (compte + échantillon)
  python tools/migration/import_g8.py fournisseurs --apply    # insère réellement (idempotent)
  python tools/migration/import_g8.py vehicules  [--apply]
  python tools/migration/import_g8.py factures   [--apply]
  python tools/migration/import_g8.py clients    [--apply]   # (export client vide à ce jour)

Idempotent : n'insère que les enregistrements dont la clé legacy n'existe pas déjà.
"""
import os, sys, re, json, zipfile, datetime, urllib.request, urllib.parse
from xml.etree import ElementTree as ET

REF = "ujmrosbgkvgvwfnuryna"
BASE = f"https://{REF}.supabase.co/rest/v1"
SVC = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
INFO = os.path.join(os.path.dirname(__file__), "..", "..", "Info DB")
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
EPOCH = datetime.date(1899, 12, 30)

def die(m): print("ERREUR:", m); sys.exit(1)
if not SVC: die("SUPABASE_SERVICE_ROLE_KEY manquant dans l'environnement.")

# ---------- lecture xlsx robuste (ignore styles.xml cassé) ----------
def _col_idx(ref):
    letters = re.match(r"([A-Z]+)", ref or "")
    if not letters: return 0
    n = 0
    for ch in letters.group(1): n = n * 26 + (ord(ch) - 64)
    return n - 1

def read_sheet(path):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        t = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in t.findall(f"{NS}si"):
            shared.append("".join(n.text or "" for n in si.iter(f"{NS}t")))
    sheets = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml", n))
    t = ET.fromstring(z.read(sheets[0]))
    sd = t.find(f"{NS}sheetData")
    out = []
    for row in sd.findall(f"{NS}row"):
        cells, maxc = {}, 0
        for c in row.findall(f"{NS}c"):
            ci = _col_idx(c.get("r")); maxc = max(maxc, ci)
            ty = c.get("t"); v = c.find(f"{NS}v"); txt = ""
            if ty == "s" and v is not None: txt = shared[int(v.text)]
            elif v is not None: txt = v.text
            else:
                isn = c.find(f"{NS}is")
                if isn is not None: txt = "".join(n.text or "" for n in isn.iter(f"{NS}t"))
            cells[ci] = (txt or "").strip()
        out.append([cells.get(i, "") for i in range(maxc + 1)])
    return out

def rows_as_dicts(path):
    rows = read_sheet(path)
    if not rows: return []
    header = rows[0]
    return [{header[i]: (r[i] if i < len(r) else "") for i in range(len(header))} for r in rows[1:]]

def xl_date(v):
    if v in (None, ""): return None
    try: n = int(float(str(v).replace(",", ".")))
    except: return None
    if n <= 0: return None
    return (EPOCH + datetime.timedelta(days=n)).isoformat()

def num(v):
    if v in (None, ""): return None
    try: return float(str(v).replace(",", "."))
    except: return None

# ---------- REST helpers ----------
def _req(method, path, body=None, prefer=None):
    url = f"{BASE}/{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", SVC); req.add_header("Authorization", f"Bearer {SVC}")
    req.add_header("Content-Type", "application/json")
    if prefer: req.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        die(f"{method} {path} -> {e.code}: {e.read().decode()[:300]}")

def get_all(path):
    out, start = [], 0
    while True:
        page = _req("GET", f"{path}{'&' if '?' in path else '?'}limit=1000&offset={start}")
        if not page: break
        out += page
        if len(page) < 1000: break
        start += 1000
    return out

def insert_batches(table, rows, size=500):
    n = 0
    for i in range(0, len(rows), size):
        _req("POST", table, rows[i:i+size], prefer="return=minimal")
        n += len(rows[i:i+size])
        print(f"  ... {n}/{len(rows)} insérés")
    return n

def company_italbike():
    rows = _req("GET", "companies?select=id,code,name")
    for c in rows:
        if (c.get("code") or "").lower() == "italbike" or "ITALBIKE" in (c.get("name") or "").upper():
            return c["id"]
    return rows[0]["id"]

COUNTRY = {"BELGIQUE":"BE","BELGIUM":"BE","FRANCE":"FR","ITALIE":"IT","ITALY":"IT","HOLLANDE":"NL",
           "PAYS-BAS":"NL","ALLEMAGNE":"DE","GERMANY":"DE","ROYAUME UNI":"GB","LUXEMBOURG":"LU","CHINA":"CN"}
def iso_country(v): return COUNTRY.get((v or "").strip().upper(), "BE")

# ---------- imports ----------
def import_fournisseurs(apply):
    cid = company_italbike()
    src = rows_as_dicts(os.path.join(INFO, "Export FOURNISSEURS 12.6.26.xlsx"))
    existing = {c["legacy_code"] for c in get_all(f"contacts?select=legacy_code&company_id=eq.{cid}&type=eq.fournisseur&legacy_code=not.is.null")}
    rows = []
    for r in src:
        code = (r.get("Code") or "").strip()
        if not code or code in existing: continue
        comp = next((r[k] for k in r if k.startswith("Compte")), "")
        acct = comp if re.fullmatch(r"\d+", comp or "") else None
        vat = comp if comp and not acct and re.match(r"[A-Z]{2}", comp) else None
        rows.append({
            "company_id": cid, "type": "fournisseur", "legacy_code": code,
            "company_name": next((r[k] for k in r if k.startswith("Raison")), "") or None,
            "city": r.get("Ville") or None, "country": iso_country(r.get("Pays")),
            "zip": next((r[k] for k in r if "ode postal" in k), "") or None,
            "phone": next((r[k] for k in r if k.startswith("T") and "phone" in k and "2" not in k), "") or None,
            "mobile": next((r[k] for k in r if "phone 2" in k), "") or None,
            "email": r.get("Email") or None, "fax": next((r[k] for k in r if "copie" in k), "") or None,
            "contact_name": r.get("Contact") or None, "account_code": acct,
            "vat_number": re.sub(r"[.\s]", "", vat) if vat else None,
            "supplier_customer_no": next((r[k] for k in r if "client achat" in k), "") or None,
            "imported_from": "G8",
        })
    print(f"FOURNISSEURS: {len(src)} lus, {len(existing)} déjà importés, {len(rows)} nouveaux.")
    if rows[:1]: print("  exemple:", json.dumps({k:v for k,v in rows[0].items() if v}, ensure_ascii=False)[:300])
    if apply and rows: insert_batches("contacts", rows)
    elif not apply: print("  (dry-run — relancer avec --apply pour insérer)")

VEH_STATUS = {"EN STOCK":"stock_vo","EN STOCK : RÉSERVÉ":"reserve","EN STOCK : VÉHICULE DE PRÊT":"courtoisie",
              "VENDU NEUF":"vendu","VENDU D'OCCASION":"vendu","VENDU EN DÉPÔT":"depot_vente","RÉPARÉ":"vendu"}
def import_vehicules(apply):
    cid = company_italbike()
    src = rows_as_dicts(os.path.join(INFO, "Export.PARC VEHICULES 12.6.26.xlsx"))
    existing = {v["reference"] for v in get_all(f"vehicles?select=reference&company_id=eq.{cid}&reference=not.is.null")}
    rows = []
    for r in src:
        ref = (r.get("Référence") or "").strip()
        if not ref or ref in existing: continue
        vin = (r.get("Châssis") or "").strip()
        if re.fullmatch(r"(.)\1{4,}", vin or ""): vin = None  # bidon 0000.../1111...
        disp = re.match(r"\d+", (r.get("Cylindrée") or "").strip())
        etat = (r.get("Etat") or "").strip()
        rows.append({
            "company_id": cid, "reference": ref, "legacy_state": etat or None,
            "status": VEH_STATUS.get(etat, "stock_vo"),
            "model": r.get("Modèle") or None, "brand": r.get("Marque") or None, "vin": vin,
            "marking": r.get("Marquage") or None, "entry_date": xl_date(r.get("Entrée le")),
            "purchase_invoice_number": next((r[k] for k in r if "Facture achat" in k), "") or None,
            "sold_date": xl_date(r.get("Vendu le")), "first_registration_date": xl_date(next((r[k] for k in r if "M.C" in k), "")),
            "color": r.get("Couleur") or None, "plate": r.get("Immatriculation") or None,
            "key_number": next((r[k] for k in r if "clef" in k), "") or None,
            "police_book_number": next((r[k] for k in r if "livre de police" in k), "") or None,
            "notes": (r.get("Commentaires") or "").strip() or None,
            "displacement": float(disp.group()) if disp else None,
            "exposition_code": next((r[k] for k in r if k.strip() == "Code Expo"), "") or None,
            "imported_from": "G8",
        })
    print(f"VEHICULES: {len(src)} lus, {len(existing)} déjà importés, {len(rows)} nouveaux.")
    if rows[:1]: print("  exemple:", json.dumps({k:v for k,v in rows[0].items() if v}, ensure_ascii=False)[:300])
    if apply and rows: insert_batches("vehicles", rows)
    elif not apply: print("  (dry-run)")

PAY = {"ESPECES/CASH":"ESP","VIREMENT":"VIR","VISA/MASTERC. DEBIT":"CB","VISA/MASTERC. CREDIT":"CB",
       "MAESTRO DEBIT":"CB","PAYPAL":"PAYPAL","CHEQUE CADEAU":"CADEAU","Multiples":"MULTI"}
def import_factures(apply, which="both"):
    cid = company_italbike()
    files = []
    if which in ("both","anterieur"): files.append("Export Facture Antérieur.xlsx")
    if which in ("both","courant"): files.append("Export Facture Courant.xlsx")
    existing = {d["legacy_number"] for d in get_all(f"documents?select=legacy_number&company_id=eq.{cid}&legacy_number=not.is.null")}
    docs = []
    total = 0
    for f in files:
        src = rows_as_dicts(os.path.join(INFO, f)); total += len(src)
        for r in src:
            no = (r.get("N° Facture") or "").strip()
            if not no or no in existing: continue
            existing.add(no)
            ttc = num(r.get("Montant TTC")) or 0
            paid = num(r.get("Acompte")) or 0
            du = num(r.get("Montant Du"))
            paid_amount = round(ttc - du, 2) if du is not None else paid
            status = "payee" if du is not None and abs(du) < 0.01 else "validee"
            rem = r.get("Remise") or ""
            docs.append({
                "company_id": cid, "doc_type": "AVO" if ttc < 0 else "FAC",
                "number": no, "legacy_number": no, "code_client_legacy": (r.get("Code client") or "").strip() or None,
                "operator": (r.get("Opérateur") or "").strip() or None,
                "issue_date": xl_date(r.get("Date")), "status": status,
                "total_ht": num(r.get("Montant HT")) or 0, "total_vat": num(r.get("Montant TVA")) or 0,
                "total_ttc": ttc, "paid_amount": paid_amount,
                "marge": num(r.get("Marge")), "marge_pct": num(r.get("% Marge")),
                "condition_reglement": (r.get("Condition de règlement") or "").strip() or None,
                "compta_transferred": "Transf" in (r.get("Compta") or ""),
                "date_transfert": xl_date(r.get("Date transfert")),
                "remise_ttc": num(re.sub(r"[^\d,.-]", "", rem)) if rem else None,
                "notes": (r.get("Note interne") or "").strip() or None, "imported_from": "G8",
            })
    print(f"FACTURES: {total} lues, {len(docs)} nouvelles à importer.")
    if docs[:1]: print("  exemple:", json.dumps({k:v for k,v in docs[0].items() if v}, ensure_ascii=False)[:300])
    if apply and docs: insert_batches("documents", docs)
    elif not apply: print("  (dry-run)")

def main():
    if len(sys.argv) < 2: die("usage: import_g8.py [fournisseurs|vehicules|factures|clients] [--apply]")
    cmd = sys.argv[1]; apply = "--apply" in sys.argv
    {"fournisseurs": import_fournisseurs, "vehicules": import_vehicules, "factures": import_factures}.get(cmd, lambda a: die("commande inconnue: "+cmd))(apply)

if __name__ == "__main__": main()
