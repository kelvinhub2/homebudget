#!/usr/bin/env bash
# deploy.sh — HomeBudget deploy script
# Run on Pi5: bash ~/deploy-homebudget.sh
set -euo pipefail

CONTAINER_NAME="homebudget"
APP_PORT="5011"
APP_DIR="/home/manuel/docker/homebudget"
DATA_DIR="/home/manuel/docker/homebudget/data"
NC_FILES="/home/manuel/docker/nextcloud/html/data/manuadmin/files"
NC_SRC="${NC_FILES}/docker-configs/homebudget"
NC_FRONTEND="${NC_FILES}/docker-configs/homebudget-frontend"
NC_IMPORTS="${NC_FILES}/budget-imports"
PROCESSED_DIR="${NC_IMPORTS}/processed"
IMAGE_NAME="homebudget-tool:latest"

echo "=== HomeBudget Deploy ==="
echo ""

# ── 1. Ensure directories exist ──────────────────────────────────────────
mkdir -p "${DATA_DIR}"
sudo mkdir -p "${NC_IMPORTS}/inbox"
sudo mkdir -p "${PROCESSED_DIR}/blkb_manuel"
sudo mkdir -p "${PROCESSED_DIR}/blkb_farnaz"
sudo mkdir -p "${PROCESSED_DIR}/blkb_joint"
sudo mkdir -p "${PROCESSED_DIR}/swisscard"
sudo mkdir -p "${PROCESSED_DIR}/amazon"
sudo mkdir -p "${PROCESSED_DIR}/other"
sudo chown -R www-data:www-data "${NC_IMPORTS}"
echo "[1/7] Directories OK"

# ── 2. Read env from running container (if exists) ────────────────────────
BUDGET_PASSWORD=""
SECRET_KEY=""
ANTHROPIC_API_KEY=""

if docker inspect "${CONTAINER_NAME}" &>/dev/null; then
    BUDGET_PASSWORD=$(docker exec "${CONTAINER_NAME}" printenv BUDGET_PASSWORD 2>/dev/null || true)
    SECRET_KEY=$(docker exec "${CONTAINER_NAME}" printenv SECRET_KEY 2>/dev/null || true)
    ANTHROPIC_API_KEY=$(docker exec "${CONTAINER_NAME}" printenv ANTHROPIC_API_KEY 2>/dev/null || true)
fi

if [ -z "${BUDGET_PASSWORD}" ]; then
    read -s -p "BUDGET_PASSWORD: " BUDGET_PASSWORD; echo
fi
if [ -z "${SECRET_KEY}" ]; then
    SECRET_KEY=$(openssl rand -hex 32)
    echo "[info] Generated new SECRET_KEY"
fi
if [ -z "${ANTHROPIC_API_KEY}" ]; then
    read -s -p "ANTHROPIC_API_KEY: " ANTHROPIC_API_KEY; echo
fi
echo "[2/7] Env vars OK"

# ── 3. Sync backend source files from Nextcloud ───────────────────────────
echo "[3/7] Syncing backend source files..."
mkdir -p "${APP_DIR}/parsers" "${APP_DIR}/static"
sudo cp -r "${NC_SRC}/." "${APP_DIR}/"
sudo chown -R manuel:manuel "${APP_DIR}"
echo "      Done"

# ── 4. Sync frontend dist from Nextcloud ──────────────────────────────────
echo "[4/7] Syncing frontend..."
if [ -d "${NC_FRONTEND}/dist" ]; then
    sudo cp -r "${NC_FRONTEND}/dist/." "${APP_DIR}/static/"
    sudo chown -R manuel:manuel "${APP_DIR}/static"
    echo "      Done ($(ls ${APP_DIR}/static | wc -l) files)"
else
    echo "      WARNING: No frontend dist found at ${NC_FRONTEND}/dist — serving API only"
fi

# ── 5. Build Docker image ─────────────────────────────────────────────────
echo "[5/7] Building Docker image (ARM64)..."
docker build --platform linux/arm64 -t "${IMAGE_NAME}" "${APP_DIR}"
echo "      Done"

# ── 6. Stop and remove old container ─────────────────────────────────────
echo "[6/7] Replacing container..."
docker stop "${CONTAINER_NAME}" 2>/dev/null || true
docker rm   "${CONTAINER_NAME}" 2>/dev/null || true

# ── 7. Start new container ────────────────────────────────────────────────
docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  -p "${APP_PORT}:8000" \
  -v "${DATA_DIR}:/data" \
  -v "${NC_FILES}:/nextcloud:ro" \
  -v "${PROCESSED_DIR}:/nextcloud/budget-imports/processed" \
  -e "BUDGET_PASSWORD=${BUDGET_PASSWORD}" \
  -e "SECRET_KEY=${SECRET_KEY}" \
  -e "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}" \
  -e "BUDGET_DB=/data/budget.db" \
  -e "BUDGET_CONFIG=/app/config.yaml" \
  -e "BUDGET_INBOX=/nextcloud/budget-imports/inbox" \
  -e "BUDGET_PROCESSED=/nextcloud/budget-imports/processed" \
  -e "TZ=Europe/Zurich" \
  "${IMAGE_NAME}"

echo "[7/7] Container started"
echo ""
echo "=== Deploy complete ==="
echo "    Local:    http://$(hostname -I | awk '{print $1}'):${APP_PORT}"
echo "    External: https://hhb.manucloud.ch"
echo ""
echo "    Logs: docker logs -f ${CONTAINER_NAME}"
