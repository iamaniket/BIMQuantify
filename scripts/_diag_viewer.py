import json, os, sys, urllib.request, urllib.parse, urllib.error

BASE = "http://localhost:8000"

def env(k):
    with open("apps/api/.env", encoding="utf-8") as f:
        for line in f:
            if line.startswith(k + "="):
                return line.split("=", 1)[1].strip()
    return None

def req(method, path, token=None, data=None, form=False, raw=False):
    url = path if path.startswith("http") else BASE + path
    headers = {}
    body = None
    if data is not None:
        if form:
            body = urllib.parse.urlencode(data).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            body = json.dumps(data).encode()
            headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    r = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            content = resp.read()
            if raw:
                return resp.status, content, dict(resp.headers)
            return resp.status, json.loads(content.decode()), None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400], None

email = env("SEED_SUPERADMIN_EMAIL"); pw = env("SEED_SUPERADMIN_PASSWORD")
st, tok, _ = req("POST", "/auth/jwt/login", data={"username": email, "password": pw}, form=True)
token = tok["access_token"]
print("LOGIN:", st)

st, projects, _ = req("GET", "/projects", token=token)
print("PROJECTS:", st, "count=", len(projects) if isinstance(projects, list) else projects)
if not isinstance(projects, list):
    sys.exit(0)
for p in projects:
    print(f"  - {p.get('name')!r} id={p.get('id')} country={p.get('country')}")

# pick Test 1 (or first)
proj = next((p for p in projects if p.get("name") == "Test 1"), projects[0] if projects else None)
if not proj:
    print("NO PROJECTS"); sys.exit(0)
pid = proj["id"]
print(f"\nUSING PROJECT {proj['name']!r} ({pid})")

st, models, _ = req("GET", f"/projects/{pid}/models", token=token)
print("MODELS:", st, "count=", len(models) if isinstance(models, list) else models)
if not isinstance(models, list):
    print(models); sys.exit(0)

for m in models:
    mid = m["id"]
    print(f"\n  MODEL {m.get('name')!r} id={mid} discipline={m.get('discipline')}")
    st, files, _ = req("GET", f"/projects/{pid}/models/{mid}/files", token=token)
    if not isinstance(files, list):
        print("    files err:", st, files); continue
    for fobj in files:
        fid = fobj["id"]
        print(f"    FILE {fobj.get('original_filename')!r} id={fid} type={fobj.get('file_type')} status={fobj.get('status')}")
        # viewer bundle
        st, b, _ = req("GET", f"/projects/{pid}/models/{mid}/files/{fid}/viewer-bundle", token=token)
        if not isinstance(b, dict):
            print("      bundle ERR:", st, b); continue
        frag = b.get("fragments_url")
        print(f"      bundle: fragments_url={'SET' if frag else 'NULL'} metadata={'SET' if b.get('metadata_url') else 'NULL'} file_url={'SET' if b.get('file_url') else 'NULL'}")
        if frag:
            # try fetch first bytes from presigned MinIO url
            try:
                fs, content, hdrs = req("GET", frag, raw=True)
                print(f"      FRAGMENTS FETCH: status={fs} bytes={len(content)} content-type={hdrs.get('Content-Type')}")
            except urllib.error.HTTPError as e:
                print(f"      FRAGMENTS FETCH HTTPError: {e.code} {e.read()[:200]}")
            except Exception as e:
                print(f"      FRAGMENTS FETCH EXC: {type(e).__name__} {e}")
