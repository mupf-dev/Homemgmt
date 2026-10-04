#!/bin/sh
# Erzeugt ein selbstsigniertes Zertifikat für HTTPS (nötig für den Kamerazugriff auf Handys im Heimnetz).
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"
mkdir -p "$DIR"
if [ -f "$DIR/cert.pem" ]; then
  echo "Zertifikat existiert bereits: $DIR/cert.pem"
  exit 0
fi
# Alle lokalen IPv4-Adressen als SAN aufnehmen, damit z. B. https://192.168.1.20:3443 passt
IPS=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9.]+$' | sed 's/^/IP:/' | paste -sd, -)
SAN="DNS:localhost,DNS:$(hostname),IP:127.0.0.1${IPS:+,$IPS}"
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$DIR/key.pem" -out "$DIR/cert.pem" \
  -subj "/CN=Heimlager" -addext "subjectAltName=$SAN" >/dev/null 2>&1
echo "Zertifikat erstellt in $DIR (gültig für: $SAN)"
echo "Server neu starten, dann https://<IP>:3443 auf dem Handy öffnen und die Warnung einmalig bestätigen."
