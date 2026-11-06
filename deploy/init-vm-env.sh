#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# -ne 1 ]]; then
  echo 'Usage: bash deploy/init-vm-env.sh app.example.com' >&2
  exit 1
fi
python3 - "$1" <<'PY'
from pathlib import Path
import os
import re
import secrets
import sys

domain = sys.argv[1].lower()
labels = domain.split('.')
if len(domain) > 253 or len(labels) < 2 or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in labels):
    sys.exit('Use a hostname such as app.example.com, without a scheme, port or path.')
values = {'APP_DOMAIN': domain, 'POSTGRES_PASSWORD': secrets.token_hex(32), 'ENCRYPTION_KEY': secrets.token_hex(32), 'SESSION_SECRET': secrets.token_hex(32)}
template = Path('.env.vm.example').read_text()
lines = [f'{line.split("=",1)[0]}={values[line.split("=",1)[0]]}' if '=' in line and line.split('=',1)[0] in values else line for line in template.splitlines()]
try:
    descriptor = os.open('.env.vm', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    sys.exit('.env.vm already exists; refusing to replace stable production secrets.')
with os.fdopen(descriptor, 'w') as output:
    output.write('\n'.join(lines) + '\n')
print('Created .env.vm with independent random secrets and permissions 0600. Edit provider settings before deployment.')
PY
