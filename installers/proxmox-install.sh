#!/usr/bin/env bash
set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'

print_header() {
  clear
  echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║${WHITE}         MyInfra LXC Installer         ${CYAN}║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
  echo
}

NEXTID=$(pvesh get /cluster/nextid 2>/dev/null)
read -rp "Container ID [$NEXTID]: " CTID
CTID=${CTID:-$NEXTID}

read -rp "Hostname [myinfra]: " HOSTNAME
HOSTNAME=${HOSTNAME:-myinfra}

read -rp "RAM MB [256]: " RAM
RAM=${RAM:-256}

read -rp "CPU Cores [1]: " CORES
CORES=${CORES:-1}

read -rp "Disk GB [1]: " DISK
DISK=${DISK:-1}

# Template selection
echo "Available templates:"
echo "--------------------------------"

mapfile -t TEMPLATES < <(pveam list local | awk '{print $1}' | grep -E 'debian|ubuntu')

for i in "${!TEMPLATES[@]}"; do
    echo "$((i+1))) ${TEMPLATES[$i]}"
done

echo "--------------------------------"
read -rp "Template number: " TEMPLATE_NUM

if [[ ! "$TEMPLATE_NUM" =~ ^[0-9]+$ ]] || [ "$TEMPLATE_NUM" -lt 1 ] || [ "$TEMPLATE_NUM" -gt "${#TEMPLATES[@]}" ]; then
    echo "Invalid template selection."
    exit 1
fi

TEMPLATE_FILE="${TEMPLATES[$((TEMPLATE_NUM-1))]}"

# Storage selection
echo "Available storage:"
echo "--------------------------------"

mapfile -t STORAGES < <(pvesm status | awk 'NR>1 {print $1}')

for i in "${!STORAGES[@]}"; do
    echo "$((i+1))) ${STORAGES[$i]}"
done

echo "--------------------------------"
read -rp "Storage number: " STORAGE_NUM
STORAGE_NUM=${STORAGE_NUM:-1}

if [[ ! "$STORAGE_NUM" =~ ^[0-9]+$ ]] || [ "$STORAGE_NUM" -lt 1 ] || [ "$STORAGE_NUM" -gt "${#STORAGES[@]}" ]; then
    echo "Invalid storage selection."
    exit 1
fi

STORAGE="${STORAGES[$((STORAGE_NUM-1))]}"

echo
echo -e "${BLUE}CTID      :${NC} $CTID"
echo -e "${BLUE}Hostname  :${NC} $HOSTNAME"
echo -e "${BLUE}RAM       :${NC} ${RAM} MB"
echo -e "${BLUE}CPU       :${NC} $CORES"
echo -e "${BLUE}Disk      :${NC} ${DISK} GB"
echo -e "${BLUE}Storage   :${NC} $STORAGE"
echo -e "${BLUE}Template  :${NC} $TEMPLATE_FILE"
echo
read -rp "Continue? (y/n): " CONFIRM

if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    exit 0
fi

pveam update

echo
echo "Creating container..."

pct create "$CTID" "$TEMPLATE_FILE" \
    --hostname "$HOSTNAME" \
    --cmode shell \
    --cores "$CORES" \
    --memory "$RAM" \
    --rootfs "$STORAGE:$DISK" \
    --net0 name=eth0,bridge=vmbr0,ip=dhcp \
    --features nesting=1 \
    --unprivileged 1 \
    --onboot 1

pct start "$CTID"

echo
echo "Starting container..."
sleep 15

pct exec "$CTID" -- bash -c "
apt update &&
apt install -y git python3 python3-pip python3-venv
"

pct exec "$CTID" -- bash -c "
mkdir -p /opt &&
cd /opt &&
rm -rf myinfra &&
git clone \
  --depth 1 \
  --branch main \
  https://github.com/Kikkerslijm410/MyInfra.git \
  myinfra
"

pct exec "$CTID" -- bash -c "
cd /opt/myinfra &&
python3 -m venv .venv &&
./.venv/bin/python -m pip install --upgrade pip &&
./.venv/bin/python -m pip install -r requirements.txt
"

pct exec "$CTID" -- bash -c "
cat > /etc/systemd/system/myinfra.service << EOF
[Unit]
Description=MyInfra
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/myinfra
ExecStart=/opt/myinfra/.venv/bin/gunicorn --bind 0.0.0.0:5000 --workers 1 wsgi:app
Restart=always
RestartSec=5
Environment=PORT=5000

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable myinfra
systemctl restart myinfra
"

IP=$(pct exec "$CTID" -- hostname -I | awk '{print $1}')

echo
echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       Installation Completed!        ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo

echo -e "${CYAN}Container ID :${NC} $CTID"
echo -e "${CYAN}IP Address   :${NC} $IP"
echo

echo -e "${YELLOW}Open MyInfra:${NC}"
echo -e "${WHITE}http://$IP:5000${NC}"
