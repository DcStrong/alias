#!/usr/bin/env bash
# Run on the explicitly selected VPS as root. No credentials belong in this script.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx curl xz-utils ca-certificates python3-venv ufw
install -d -m 755 /opt/alias/releases /var/www/alias-acme
if ! id alias >/dev/null 2>&1; then useradd --system --user-group --home-dir /opt/alias --shell /usr/sbin/nologin alias; fi
node_tmp=$(mktemp -d)
trap 'rm -rf "$node_tmp"' EXIT
curl --fail --silent --show-error --location https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$node_tmp/SHASUMS256.txt"
node_archive=$(awk '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$/ {print $2}' "$node_tmp/SHASUMS256.txt")
[[ "$node_archive" =~ ^node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$ ]]
curl --fail --silent --show-error --location "https://nodejs.org/dist/latest-v24.x/$node_archive" -o "$node_tmp/$node_archive"
(cd "$node_tmp"; awk -v archive="$node_archive" '$2==archive' SHASUMS256.txt | sha256sum --check -)
node_directory=${node_archive%.tar.xz}
tar -xJf "$node_tmp/$node_archive" -C /opt/alias
ln -sfn "/opt/alias/$node_directory" /opt/alias/node
/opt/alias/node/bin/node --version
python3 -m venv /opt/alias-certbot
/opt/alias-certbot/bin/pip install --quiet 'certbot>=5.4'
/opt/alias-certbot/bin/certbot --version
# The user explicitly dedicated this VPS to Alias. Preserve old app data, stop the conflicting listener.
if systemctl list-unit-files x-ui.service --no-legend | grep -q x-ui; then systemctl disable --now x-ui.service; fi
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
