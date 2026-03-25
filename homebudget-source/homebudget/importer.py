"""
importer.py — Full import pipeline orchestrator

Flow:
  detect → account lookup → parse → normalise → deduplicate
  → categorize → log → move to processed/
"""
import os
import shutil
from datetime import datetime

import yaml

from parsers.detect    import detect_source, SOURCE_BLKB, SOURCE_SWISSCARD, SOURCE_AMAZON, SOURCE_UBS
from parsers.blkb      import parse as parse_blkb
from parsers.swisscard import parse as parse_swisscard
from parsers.amazon    import parse as parse_amazon
from parsers.ubs       import parse as parse_ubs
from db import (
    insert_transaction, categorize_transaction,
    create_import_log, update_import_log, get_conn
)

CONFIG_PATH    = os.environ.get("BUDGET_CONFIG", "/app/config.yaml")
PROCESSED_ROOT = os.environ.get("BUDGET_PROCESSED", "/nextcloud/budget-imports/processed")


def load_config() -> dict:
    with open(CONFIG_PATH, "r") as f:
        return yaml.safe_load(f)


def get_processed_dir(source: str, account_name: str) -> str:
    """Return target directory under processed/ for a given source + account."""
    safe_name = account_name.lower().replace(" ", "_")
    path = os.path.join(PROCESSED_ROOT, safe_name)
    os.makedirs(path, exist_ok=True)
    return path


def import_file(filepath: str, force_account_id: str = None) -> dict:
    """
    Import a single file through the full pipeline.

    Returns:
      {
        "status":            "ok" | "error" | "unknown_source" | "unknown_account",
        "source":            str,
        "account_id":        str,
        "tx_count":          int,
        "duplicate_count":   int,
        "unclassified_count":int,
        "errors":            list[str]
      }
    """
    config   = load_config()
    accounts = config.get("accounts", {})
    fx_rates = config.get("fx_rates", {})

    result = {
        "status":             "ok",
        "source":             "",
        "account_id":         "",
        "filename":           os.path.basename(filepath),
        "tx_count":           0,
        "duplicate_count":    0,
        "unclassified_count": 0,
        "errors":             [],
    }

    # ── Step 1: Detect source ──────────────────────────────────────────────
    detection = detect_source(filepath)
    result["source"] = detection["source"]

    if detection["source"] == "Unknown":
        result["status"] = "unknown_source"
        result["errors"].append(detection.get("error", "Unknown file format"))
        return result

    # ── Step 2: Account lookup ─────────────────────────────────────────────
    account_id = force_account_id
    account_name = "unknown"

    if not account_id:
        key = detection["account_key"]

        if detection["source"] == "Amazon":
            # Amazon uses a virtual account per owner — default to manuel
            # Can be overridden via force_account_id
            account_id   = "amazon_manuel"
            account_name = "Amazon"
        else:
            acc_cfg = accounts.get(key)
            if not acc_cfg:
                result["status"] = "unknown_account"
                result["errors"].append(
                    f"Account key '{key}' not found in config.yaml. "
                    f"Add it to accounts section."
                )
                return result
            account_id   = key
            account_name = acc_cfg.get("name", key)

    result["account_id"] = account_id

    # Ensure account exists in DB
    _upsert_account(account_id, account_name, detection["source"], config)

    # ── Step 3: Create import log entry ───────────────────────────────────
    import_id = create_import_log(
        os.path.basename(filepath), detection["source"], account_id
    )

    # ── Step 4: Parse ─────────────────────────────────────────────────────
    try:
        if detection["source"] == SOURCE_BLKB:
            transactions = parse_blkb(filepath, account_id, import_id)

        elif detection["source"] == SOURCE_SWISSCARD:
            transactions = parse_swisscard(filepath, account_id, import_id)

        elif detection["source"] == SOURCE_AMAZON:
            transactions = parse_amazon(filepath, account_id, import_id, fx_rates)

        elif detection["source"] == SOURCE_UBS:
            transactions = parse_ubs(filepath, account_id, import_id)

        else:
            result["status"] = "error"
            result["errors"].append("No parser available for source")
            return result

    except Exception as e:
        result["status"] = "error"
        result["errors"].append(f"Parse error: {str(e)}")
        return result

    # ── Step 5: Categorize + insert ───────────────────────────────────────
    tx_count          = 0
    duplicate_count   = 0
    unclassified_count = 0

    for tx in transactions:
        # Apply rules
        cat = categorize_transaction(
            tx["raw_text"], tx["merchant_clean"], tx["amount"]
        )
        tx["l1"] = cat["l1"]
        tx["l2"] = cat["l2"]
        if cat["is_recurring"]:
            tx["is_recurring"] = 1

        if not tx["l1"]:
            unclassified_count += 1

        inserted = insert_transaction(tx)
        if inserted:
            tx_count += 1
        else:
            duplicate_count += 1

    # ── Step 6: Update import log ──────────────────────────────────────────
    update_import_log(import_id, tx_count, duplicate_count, unclassified_count)

    result["tx_count"]           = tx_count
    result["duplicate_count"]    = duplicate_count
    result["unclassified_count"] = unclassified_count

    # ── Step 7: Move to processed/ ────────────────────────────────────────
    try:
        dest_dir = get_processed_dir(detection["source"], account_name)
        dest     = os.path.join(dest_dir, os.path.basename(filepath))
        # Avoid overwrite
        if os.path.exists(dest):
            ts    = datetime.now().strftime("%Y%m%d_%H%M%S")
            base, ext = os.path.splitext(os.path.basename(filepath))
            dest  = os.path.join(dest_dir, f"{base}_{ts}{ext}")
        shutil.move(filepath, dest)
    except Exception as e:
        result["errors"].append(f"Could not move to processed/: {str(e)}")
        # Non-fatal

    return result


def _upsert_account(account_id: str, name: str, source: str, config: dict):
    """Insert account into DB if not already present."""
    accounts_cfg = config.get("accounts", {})
    acc          = accounts_cfg.get(account_id, {})

    with get_conn() as conn:
        conn.execute("""
            INSERT OR IGNORE INTO accounts (id, name, owner, bank, currency)
            VALUES (?, ?, ?, ?, ?)
        """, (
            account_id,
            acc.get("name", name),
            acc.get("owner", "unknown"),
            acc.get("bank", source),
            acc.get("currency", "CHF"),
        ))


def scan_hotfolder(inbox_path: str) -> list[dict]:
    """
    Scan inbox folder and import all new files.
    Returns list of import results.
    """
    if not os.path.isdir(inbox_path):
        return []

    results = []
    for filename in sorted(os.listdir(inbox_path)):
        if filename.startswith(".") or filename.startswith("~"):
            continue
        ext = os.path.splitext(filename)[1].lower()
        if ext not in (".xlsx", ".xlsm", ".csv"):
            continue
        filepath = os.path.join(inbox_path, filename)
        if os.path.isfile(filepath):
            result = import_file(filepath)
            results.append(result)

    return results
