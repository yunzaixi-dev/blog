#!/usr/bin/env python3
"""Existing Pages Direct Upload entrypoint: <directory> <project> <branch>."""
import base64
import hashlib
import json
import mimetypes
import os
import sys
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor

directory, project, branch = sys.argv[1:4]
token = os.environ["CLOUDFLARE_API_TOKEN"]
account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
API = "https://api.cloudflare.com/client/v4"


def request(url, auth, data=None, content_type="application/json"):
    headers = {"Authorization": "Bearer " + auth}
    if data is not None:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as response:
        result = json.load(response)
    if not result.get("success"):
        raise RuntimeError(f"Cloudflare API failed: {result.get('errors')}")
    return result.get("result")


special = {}
for name in ("_headers", "_redirects", "_routes.json"):
    filename = os.path.join(directory, name)
    if os.path.isfile(filename):
        with open(filename, "rb") as file:
            special[name] = file.read()
files = {}
for root, _, names in os.walk(directory):
    for name in names:
        filename = os.path.join(root, name)
        relative = "/" + os.path.relpath(filename, directory).replace(os.sep, "/")
        if relative[1:] in special:
            continue
        with open(filename, "rb") as file:
            encoded = base64.b64encode(file.read()).decode()
        extension = os.path.splitext(name)[1].lstrip(".")
        key = hashlib.sha256((encoded + extension).encode()).hexdigest()[:32]
        files[relative] = (key, encoded, mimetypes.guess_type(name)[0] or "application/octet-stream")
base = f"{API}/accounts/{account}/pages/projects/{project}"
jwt = request(base + "/upload-token", token)["jwt"]
hashes = list({value[0] for value in files.values()})
missing = set(request(API + "/pages/assets/check-missing", jwt, json.dumps({"hashes": hashes}).encode()))
pending = {value[0]: value for value in files.values() if value[0] in missing}
batches, batch, size = [], [], 0
for key, encoded, content_type in pending.values():
    if batch and (size + len(encoded) > 40_000_000 or len(batch) >= 1000):
        batches.append(batch)
        batch, size = [], 0
    batch.append({"key": key, "value": encoded, "metadata": {"contentType": content_type}, "base64": True})
    size += len(encoded)
if batch:
    batches.append(batch)
with ThreadPoolExecutor(4) as executor:
    list(executor.map(lambda value: request(API + "/pages/assets/upload", jwt, json.dumps(value).encode()), batches))
if pending:
    request(API + "/pages/assets/upsert-hashes", jwt, json.dumps({"hashes": hashes}).encode())
boundary = uuid.uuid4().hex
body = b""
for key, value in (("manifest", json.dumps({key: value[0] for key, value in files.items()})),
                   ("branch", branch), ("commit_hash", os.environ.get("SOURCE_SHA", "")),
                   ("commit_dirty", "false")):
    body += f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
for name, content in special.items():
    body += (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{name}"\r\n'
             'Content-Type: application/octet-stream\r\n\r\n').encode() + content + b"\r\n"
body += f"--{boundary}--\r\n".encode()
deployment = request(base + "/deployments", token, body, f"multipart/form-data; boundary={boundary}")
print(f"files={len(files)} uploaded={len(pending)} deployment={deployment['id']} url={deployment['url']}")
