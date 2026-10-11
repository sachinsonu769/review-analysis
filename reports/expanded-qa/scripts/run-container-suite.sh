#!/bin/sh
set -eu
cd /tmp
mkdir exact-qa-source
for item in src app ui fixtures test package.json package-lock.json tsconfig.json; do
  cp -a "/qa/source/$item" exact-qa-source/
done
ln -s /opt/review-analysis/node_modules exact-qa-source/node_modules
cd exact-qa-source
node --version
java -version
git --version
/opt/pmd/bin/pmd --version
npm run build
node --test
