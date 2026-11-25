#!/bin/sh
# Builds the static site for Netlify. The Go server must run elsewhere.
set -eu

case "${BACKEND_URL:-}" in
  https://*) ;;
  *) echo "Set BACKEND_URL to the https URL of the Go server" >&2; exit 1 ;;
esac
backend="${BACKEND_URL%/}"
ws_backend="wss://${backend#https://}"

rm -rf dist
mkdir dist
cp -r web/static dist/static
cp web/index.html web/game.html dist/
printf "const BACKEND_URL = '%s';\n" "$backend" > dist/static/js/config.js

cat > dist/_redirects <<EOF
/:room /game.html 200
EOF

cat > dist/_headers <<EOF
/*
  Content-Security-Policy: default-src 'self'; connect-src 'self' $ws_backend; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
EOF
