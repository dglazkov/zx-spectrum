#!/bin/sh
# What this part depends on, installed where nothing has, as a session's directory and a robot's clone have only what
# git keeps, or where a take moved its lock (crux#128). One at a time, as the tests that run on the part start side by
# side, and `npm ci` takes node_modules from under any beside it: whoever comes second waits, and finds it done. A
# product's test runs it first, from wherever it stands, as `sh crux/chrome/ready.sh && ...`.
cd "$(dirname "$0")" || exit
exec flock package-lock.json sh -c '
  [ node_modules/.package-lock.json -nt package-lock.json ] ||
    npm ci --no-audit --no-fund --loglevel=error'
