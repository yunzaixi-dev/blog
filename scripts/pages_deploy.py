#!/usr/bin/env python3
"""Minimal Cloudflare Pages Direct Upload (no Node/wrangler). Usage: pages_deploy.py <dir> <project> <branch>"""
import base64, hashlib, json, mimetypes, os, sys, urllib.request, uuid
from concurrent.futures import ThreadPoolExecutor
d, proj, branch = sys.argv[1:4]
tok, acc = os.environ["CLOUDFLARE_API_TOKEN"], os.environ["CLOUDFLARE_ACCOUNT_ID"]
API = "https://api.cloudflare.com/client/v4"
def req(url, auth, data=None, ctype="application/json", method=None):
    r = urllib.request.Request(url, data=data, method=method or ("POST" if data is not None else "GET"),
                               headers={"Authorization": "Bearer " + auth, **({"Content-Type": ctype} if data is not None else {})})
    with urllib.request.urlopen(r, timeout=60) as resp:
        j = json.load(resp)
    if not j.get("success"): sys.exit(f"API error {url}: {j.get('errors')}")
    return j.get("result")
# Pages reads these from their own form fields (as wrangler sends them); in the
# asset manifest they are just files and the rules never apply.
SPECIAL = ("_headers", "_redirects", "_routes.json")
special = {n: open(os.path.join(d, n), "rb").read() for n in SPECIAL if os.path.isfile(os.path.join(d, n))}
files = {}
for root, _, names in os.walk(d):
    for n in names:
        p = os.path.join(root, n); rel = "/" + os.path.relpath(p, d).replace(os.sep, "/")
        if rel[1:] in special: continue
        b64 = base64.b64encode(open(p, "rb").read()).decode()
        ext = os.path.splitext(n)[1].lstrip(".")
        h = hashlib.sha256((b64 + ext).encode()).hexdigest()[:32]
        files[rel] = (h, b64, mimetypes.guess_type(n)[0] or "application/octet-stream")
base = f"{API}/accounts/{acc}/pages/projects/{proj}"
jwt = req(base + "/upload-token", tok)["jwt"]
hashes = list({v[0] for v in files.values()})
missing = set(req(API + "/pages/assets/check-missing", jwt, json.dumps({"hashes": hashes}).encode()))
todo = {v[0]: v for v in files.values() if v[0] in missing}
batches, cur, size = [], [], 0
for h, b64, ct in todo.values():
    if cur and (size + len(b64) > 40_000_000 or len(cur) >= 1000): batches.append(cur); cur, size = [], 0
    cur.append({"key": h, "value": b64, "metadata": {"contentType": ct}, "base64": True}); size += len(b64)
if cur: batches.append(cur)
with ThreadPoolExecutor(4) as ex:
    list(ex.map(lambda b: req(API + "/pages/assets/upload", jwt, json.dumps(b).encode()), batches))
if todo: req(API + "/pages/assets/upsert-hashes", jwt, json.dumps({"hashes": hashes}).encode())
bd = uuid.uuid4().hex; parts = []
for k, v in (("manifest", json.dumps({k: v[0] for k, v in files.items()})), ("branch", branch),
             ("commit_hash", os.environ.get("GITHUB_SHA", "")), ("commit_dirty", "true")):
    if v: parts.append(f'--{bd}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n')
body = "".join(parts).encode()
for n, content in special.items():
    body += (f'--{bd}\r\nContent-Disposition: form-data; name="{n}"; filename="{n}"\r\n'
             f'Content-Type: application/octet-stream\r\n\r\n').encode() + content + b"\r\n"
body += f"--{bd}--\r\n".encode()
dep = req(base + "/deployments", tok, body, f"multipart/form-data; boundary={bd}")
print(f"files={len(files)} uploaded={len(todo)} rules={','.join(special) or 'none'} deployment={dep['id']} url={dep['url']}")
