#!/bin/sh
set -eu
cd /inputs/foreign-owned-git
chown -R 0:0 .
git init -q
git config user.name 'Synthetic QA'
git config user.email 'synthetic@example.invalid'
printf 'export const original = 1;\n' > a.ts
git add .
git commit -qm original
original=$(git rev-parse HEAD)
printf 'export const replacement = 2;\n' > a.ts
git add .
git commit -qm replacement
replacement=$(git rev-parse HEAD)
git replace "$original" "$replacement"
printf '#!/bin/sh\nprintf executed > /tmp/expanded-qa-foreign-fsmonitor-executed\nprintf "qa-token\\000"\n' > .git/qa-fsmonitor
chmod 755 .git/qa-fsmonitor
git config core.fsmonitor /inputs/foreign-owned-git/.git/qa-fsmonitor
printf 'export const dirty = 3;\n' > a.ts
chmod -R a+rX .
printf '{"original":"%s","replacement":"%s"}\n' "$original" "$replacement"
