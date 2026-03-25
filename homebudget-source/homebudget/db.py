"""
db.py — Database layer
SQLite schema, initialization, and helper functions
"""
import sqlite3
import os
import hashlib
from datetime import datetime
from typing import Optional

DB_PATH = os.environ.get("BUDGET_DB", "/data/budget.db")


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """Create all tables if they don't exist."""
    with get_conn() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS accounts (
            id          TEXT PRIMARY KEY,   -- e.g. "CH1600769056912992003"
            name        TEXT NOT NULL,      -- e.g. "BLKB Manuel"
            owner       TEXT NOT NULL,      -- manuel / farnaz / joint
            bank        TEXT NOT NULL,      -- BLKB / Swisscard / Amazon
            currency    TEXT NOT NULL DEFAULT 'CHF'
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id                  TEXT PRIMARY KEY,
            date                TEXT NOT NULL,          -- ISO 8601 YYYY-MM-DD
            account_id          TEXT,
            amount              REAL NOT NULL,          -- CHF, negative=debit, positive=credit
            currency            TEXT NOT NULL DEFAULT 'CHF',
            amount_orig         REAL,                   -- original amount in foreign currency
            currency_orig       TEXT,                   -- original currency if != CHF
            fx_rate             REAL,                   -- rate used for conversion
            raw_text            TEXT,                   -- original booking text, never modified
            merchant_clean      TEXT,                   -- extracted merchant name
            tx_type             TEXT,                   -- TWINT_MERCHANT / TWINT_P2P / CARD /
                                                        -- INCOMING / INTERNAL_TRANSFER / ATM / OTHER
            l1                  TEXT DEFAULT '',
            l2                  TEXT DEFAULT '',
            is_recurring        INTEGER DEFAULT 0,      -- 1 = recurring payment
            is_sub              INTEGER DEFAULT 0,      -- 1 = subscription (subtype of recurring)
            is_internal         INTEGER DEFAULT 0,      -- 1 = internal transfer, excluded from reports
            is_split            INTEGER DEFAULT 0,      -- 1 = part of a split transaction
            parent_id           TEXT,                   -- for split transactions
            import_id           INTEGER,
            manually_reviewed   INTEGER DEFAULT 0,      -- 1 = protected from bulk re-categorization
            created_at          TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (account_id) REFERENCES accounts(id),
            FOREIGN KEY (import_id)  REFERENCES imports(id)
        );

        CREATE INDEX IF NOT EXISTS idx_tx_date       ON transactions(date);
        CREATE INDEX IF NOT EXISTS idx_tx_account    ON transactions(account_id);
        CREATE INDEX IF NOT EXISTS idx_tx_l1         ON transactions(l1);
        CREATE INDEX IF NOT EXISTS idx_tx_merchant   ON transactions(merchant_clean);
        CREATE INDEX IF NOT EXISTS idx_tx_reviewed   ON transactions(manually_reviewed);

        CREATE TABLE IF NOT EXISTS rules (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            priority        INTEGER NOT NULL DEFAULT 500, -- lower = higher priority
            merchant        TEXT NOT NULL,               -- substring match against merchant_clean
            keyword         TEXT DEFAULT '',             -- additional substring match against raw_text
            amount_min      REAL,                        -- optional amount range filter
            amount_max      REAL,
            is_recurring    INTEGER DEFAULT 0,           -- if 1, also sets is_recurring on match
            l1              TEXT NOT NULL DEFAULT '',
            l2              TEXT NOT NULL DEFAULT '',
            active          INTEGER DEFAULT 1,           -- 0 = disabled
            created_at      TEXT DEFAULT (datetime('now')),
            updated_at      TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_rules_priority ON rules(priority);
        CREATE INDEX IF NOT EXISTS idx_rules_active   ON rules(active);

        CREATE TABLE IF NOT EXISTS imports (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            filename        TEXT NOT NULL,
            source          TEXT,                        -- detected source type
            account_id      TEXT,
            imported_at     TEXT DEFAULT (datetime('now')),
            tx_count        INTEGER DEFAULT 0,
            duplicate_count INTEGER DEFAULT 0,
            unclassified_count INTEGER DEFAULT 0,
            status          TEXT DEFAULT 'ok'            -- ok / error
        );

        CREATE TABLE IF NOT EXISTS taxonomy (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            l1      TEXT NOT NULL,
            l2      TEXT NOT NULL,
            UNIQUE(l1, l2)
        );
        """)
    _seed_taxonomy()


def _seed_taxonomy():
    """Insert default L1/L2 taxonomy if empty."""
    default = {
        "Income":              ["Salary", "Reimbursement", "Household Refunds",
                                "Rental Income", "Solar", "Marketplace Sale", "Other"],
        "Housing":             ["Mortgage", "Rent", "Electricity", "Gas", "Water",
                                "TV & Internet", "Cleaning", "Furniture", "Maintenance",
                                "Garden", "Insurance", "Smart Home", "Other"],
        "Food & Household":    ["Groceries", "Restaurant", "Food Delivery",
                                "Bakery", "Butcher", "Canteen", "Other"],
        "Mobility":            ["Fuel", "Car Payment", "Car Repair", "Car Insurance",
                                "Car Tax", "Public Transport", "Parking", "Taxi",
                                "Telecom", "Bike", "Other"],
        "Health & Insurance":  ["Health Insurance", "Doctors", "Dentist", "Pharmacy",
                                "Optician", "Wellness", "Lab", "Other"],
        "Children":            ["Childcare", "Nanny", "School", "Activities",
                                "Music Lessons", "Sports", "Clothing", "Toys", "Other"],
        "Lifestyle & Leisure": ["Travel", "Hotel", "Activities", "Culture",
                                "Sport & Fitness", "Subscriptions", "Gifts",
                                "Donations", "Shopping", "Electronics", "Gaming",
                                "Dining Out", "Events", "Other"],
        "Taxes & Savings":     ["Income Tax", "Pension 2nd Pillar", "Pension 3rd Pillar",
                                "Wealth Tax", "Fines", "Fees", "Other"],
        "Transfers":           ["Internal Transfer", "ATM", "CC Settlement",
                                "P2P Transfer", "Other"],
    }
    with get_conn() as conn:
        existing = conn.execute("SELECT COUNT(*) FROM taxonomy").fetchone()[0]
        if existing == 0:
            for l1, l2_list in default.items():
                for l2 in l2_list:
                    conn.execute(
                        "INSERT OR IGNORE INTO taxonomy (l1, l2) VALUES (?, ?)", (l1, l2)
                    )


# ── Transaction helpers ────────────────────────────────────────────────────

def make_tx_id(source: str, date: str, amount: float, raw_text: str) -> str:
    """Deterministic transaction ID — same input always produces same ID."""
    key = f"{source}|{date}|{amount}|{raw_text[:80]}"
    return "TXN-" + hashlib.sha256(key.encode()).hexdigest()[:10]


def tx_exists(tx_id: str) -> bool:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM transactions WHERE id = ?", (tx_id,)
        ).fetchone()
        return row is not None


def insert_transaction(tx: dict) -> bool:
    """Insert a transaction. Returns False if duplicate."""
    if tx_exists(tx["id"]):
        return False
    with get_conn() as conn:
        conn.execute("""
            INSERT INTO transactions
            (id, date, account_id, amount, currency, amount_orig, currency_orig,
             fx_rate, raw_text, merchant_clean, tx_type, l1, l2,
             is_recurring, is_sub, is_internal, import_id)
            VALUES
            (:id, :date, :account_id, :amount, :currency, :amount_orig, :currency_orig,
             :fx_rate, :raw_text, :merchant_clean, :tx_type, :l1, :l2,
             :is_recurring, :is_sub, :is_internal, :import_id)
        """, tx)
    return True


# ── Rules helpers ──────────────────────────────────────────────────────────

def get_rules(active_only: bool = True) -> list[dict]:
    with get_conn() as conn:
        q = "SELECT * FROM rules"
        if active_only:
            q += " WHERE active = 1"
        q += " ORDER BY priority ASC"
        return [dict(r) for r in conn.execute(q).fetchall()]


def categorize_transaction(raw_text: str, merchant: str, amount: float) -> dict:
    """
    Apply rules in priority order (first-match-wins).
    Returns dict with l1, l2, is_recurring, matched_rule_id or None.
    """
    rules = get_rules()
    text_upper    = (raw_text or "").upper()
    merchant_upper = (merchant or "").upper()

    for rule in rules:
        # merchant match — skip if merchant empty (keyword-only rule)
        if rule["merchant"] and rule["merchant"].upper() not in merchant_upper:
            continue
        # keyword match (required if merchant is empty, otherwise optional)
        if rule["keyword"]:
            if rule["keyword"].upper() not in text_upper:
                continue
        elif not rule["merchant"]:
            continue  # neither merchant nor keyword — skip invalid rule
        # amount range (optional)
        if rule["amount_min"] is not None and abs(amount) < rule["amount_min"]:
            continue
        if rule["amount_max"] is not None and abs(amount) > rule["amount_max"]:
            continue
        # match found
        return {
            "l1":           rule["l1"],
            "l2":           rule["l2"],
            "is_recurring": rule["is_recurring"],
            "rule_id":      rule["id"],
        }

    return {"l1": "", "l2": "", "is_recurring": 0, "rule_id": None}


def recategorize_all():
    """
    Re-apply rules to all transactions where manually_reviewed = 0.
    Called after rules are updated.
    """
    with get_conn() as conn:
        txs = conn.execute("""
            SELECT id, raw_text, merchant_clean, amount
            FROM transactions
            WHERE manually_reviewed = 0
        """).fetchall()

        updated = 0
        for tx in txs:
            result = categorize_transaction(
                tx["raw_text"], tx["merchant_clean"], tx["amount"]
            )
            conn.execute("""
                UPDATE transactions
                SET l1 = ?, l2 = ?, is_recurring = ?
                WHERE id = ?
            """, (result["l1"], result["l2"], result["is_recurring"], tx["id"]))
            updated += 1
    return updated


# ── Taxonomy helpers ───────────────────────────────────────────────────────

def get_taxonomy() -> dict:
    """Returns {l1: [l2, l2, ...]} dict."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT l1, l2 FROM taxonomy ORDER BY l1, l2"
        ).fetchall()
    result = {}
    for row in rows:
        result.setdefault(row["l1"], []).append(row["l2"])
    return result


def rename_category(old_l1: str, old_l2: Optional[str],
                    new_l1: str, new_l2: Optional[str]):
    """Rename L1 or L2 — updates taxonomy + all transactions."""
    with get_conn() as conn:
        if old_l2 and new_l2:
            conn.execute(
                "UPDATE taxonomy SET l1=?, l2=? WHERE l1=? AND l2=?",
                (new_l1, new_l2, old_l1, old_l2)
            )
            conn.execute(
                "UPDATE transactions SET l1=?, l2=? WHERE l1=? AND l2=?",
                (new_l1, new_l2, old_l1, old_l2)
            )
            conn.execute(
                "UPDATE rules SET l1=?, l2=? WHERE l1=? AND l2=?",
                (new_l1, new_l2, old_l1, old_l2)
            )
        else:
            # Rename L1 only
            conn.execute(
                "UPDATE taxonomy SET l1=? WHERE l1=?", (new_l1, old_l1)
            )
            conn.execute(
                "UPDATE transactions SET l1=? WHERE l1=?", (new_l1, old_l1)
            )
            conn.execute(
                "UPDATE rules SET l1=? WHERE l1=?", (new_l1, old_l1)
            )


def delete_l2(l1: str, l2: str, move_to_l1: str, move_to_l2: str):
    """Delete L2 category and move all transactions to another category."""
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM taxonomy WHERE l1=? AND l2=?", (l1, l2)
        )
        conn.execute(
            "UPDATE transactions SET l1=?, l2=? WHERE l1=? AND l2=?",
            (move_to_l1, move_to_l2, l1, l2)
        )
        conn.execute(
            "UPDATE rules SET l1=?, l2=? WHERE l1=? AND l2=?",
            (move_to_l1, move_to_l2, l1, l2)
        )


# ── Import log ─────────────────────────────────────────────────────────────

def create_import_log(filename: str, source: str, account_id: str) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO imports (filename, source, account_id) VALUES (?, ?, ?)",
            (filename, source, account_id)
        )
        return cur.lastrowid


def update_import_log(import_id: int, tx_count: int,
                      duplicate_count: int, unclassified_count: int):
    with get_conn() as conn:
        conn.execute("""
            UPDATE imports
            SET tx_count=?, duplicate_count=?, unclassified_count=?
            WHERE id=?
        """, (tx_count, duplicate_count, unclassified_count, import_id))
