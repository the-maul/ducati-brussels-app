#!/usr/bin/env python3
"""
M14 — Attache chaque FACTURE PDF (Info DB) à son document en GED (bucket prive 'ged'),
pour ouvrir la facture d'origine depuis l'app. Idempotent (saute si deja attache).
Usage : python tools/migration/import_pdf_ged.py [--limit N]
"""
import os, sys, re, json, glob, urllib.request
REF="ujmrosbgkvgvwfnuryna"; BASE=f"https://{REF}.supabase.co"; SVC=os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
INFO=os.path.join(os.path.dirname(__file__),"..","..","Info DB")
if not SVC: sys.exit("SUPABASE_SERVICE_ROLE_KEY manquant")
H={"apikey":SVC,"Authorization":f"Bearer {SVC}"}
def rest(method,path,body=None,prefer=None):
    r=urllib.request.Request(f"{BASE}/rest/v1/{path}",data=(json.dumps(body).encode() if body is not None else None),method=method)
    for k,v in H.items(): r.add_header(k,v)
    r.add_header("Content-Type","application/json")
    if prefer: r.add_header("Prefer",prefer)
    try:
        with urllib.request.urlopen(r) as x: raw=x.read().decode(); return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e: sys.exit(f"{method} {path} {e.code}: {e.read().decode()[:200]}")
def upload(path,data):
    r=urllib.request.Request(f"{BASE}/storage/v1/object/ged/{path}",data=data,method="POST")
    for k,v in H.items(): r.add_header(k,v)
    r.add_header("Content-Type","application/pdf"); r.add_header("x-upsert","true")
    try: urllib.request.urlopen(r)
    except urllib.error.HTTPError as e:
        if e.code not in (200,409): sys.exit(f"upload {e.code}: {e.read().decode()[:150]}")

limit=int(sys.argv[sys.argv.index("--limit")+1]) if "--limit" in sys.argv else None
co=rest("GET","companies?select=id,code"); cid=next((c["id"] for c in co if (c.get("code") or "").lower()=="italbike"),co[0]["id"])
files=sorted(glob.glob(os.path.join(INFO,"FACTURE *.pdf")))
if limit: files=files[:limit]
done=0; skip=0; nodoc=0
for f in files:
    m=re.search(r"(\d{6,})",os.path.basename(f));  num=m.group(1) if m else None
    if not num: continue
    docs=rest("GET",f"documents?select=id&company_id=eq.{cid}&legacy_number=eq.{num}")
    if not docs: nodoc+=1; continue
    did=docs[0]["id"]
    fname=f"FACTURE_{num}.pdf"
    exist=rest("GET",f"attachments?select=id&entity_id=eq.{did}&entity_type=eq.document&file_name=eq.{fname}&limit=1")
    if exist: skip+=1; continue
    data=open(f,"rb").read()
    spath=f"{cid}/document/{did}/{fname}"
    upload(spath,data)
    rest("POST","attachments",{"company_id":cid,"entity_type":"document","entity_id":did,"file_name":fname,
        "storage_path":spath,"content_type":"application/pdf","size_bytes":len(data),"note":"Facture d'origine (G8)"},prefer="return=minimal")
    done+=1
    if done % 100 == 0: print(f"... {done} attaches")
print(f"FAIT : {done} PDF attaches, {skip} deja faits, {nodoc} sans doc.")
