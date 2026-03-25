"""
main.py — FastAPI application
HomeBudget — Haushalt Muttenz
"""
import os
import asyncio
import threading
import time
from contextlib import asynccontextmanager
from typing import Optional

import yaml
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import db
from importer import import_file, scan_hotfolder, load_config

CONFIG_PATH  = os.environ.get("BUDGET_CONFIG", "/app/config.yaml")
INBOX_PATH   = os.environ.get("BUDGET_INBOX",  "/nextcloud/budget-imports/inbox")
UPLOAD_TMP   = "/tmp/homebudget_uploads"
os.makedirs(UPLOAD_TMP, exist_ok=True)


# ── Auth ───────────────────────────────────────────────────────────────────

from fastapi.security import HTTPBasic, HTTPBasicCredentials
import secrets

security = HTTPBasic()

def require_auth(credentials: HTTPBasicCredentials = Depends(security)):
    password = os.environ.get("BUDGET_PASSWORD", "changeme")
    ok = secrets.compare_digest(credentials.password.encode(), password.encode())
    if not ok:
        raise HTTPException(status_code=401, detail="Unauthorized",
                            headers={"WWW-Authenticate": "Basic"})
    return credentials.username


# ── Hotfolder background task ──────────────────────────────────────────────

def _hotfolder_loop():
    config  = load_config()
    poll    = config.get("app", {}).get("hotfolder_poll_seconds", 300)
    while True:
        try:
            scan_hotfolder(INBOX_PATH)
        except Exception as e:
            print(f"[hotfolder] error: {e}")
        time.sleep(poll)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    t = threading.Thread(target=_hotfolder_loop, daemon=True)
    t.start()
    yield


# ── App ────────────────────────────────────────────────────────────────────

app = FastAPI(title="HomeBudget", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Upload ─────────────────────────────────────────────────────────────────

@app.post("/api/import/upload")
async def upload_file(
    file: UploadFile = File(...),
    account_id: Optional[str] = None,
    _user = Depends(require_auth)
):
    """Manual file upload — same pipeline as hotfolder."""
    suffix = os.path.splitext(file.filename)[1]
    tmp    = os.path.join(UPLOAD_TMP, file.filename)

    with open(tmp, "wb") as f:
        content = await file.read()
        f.write(content)

    result = import_file(tmp, force_account_id=account_id)
    return result


@app.post("/api/import/scan")
async def trigger_scan(_user = Depends(require_auth)):
    """Manually trigger hotfolder scan."""
    results = scan_hotfolder(INBOX_PATH)
    return {"scanned": len(results), "results": results}


# ── Transactions ───────────────────────────────────────────────────────────

@app.get("/api/transactions")
def get_transactions(
    month:         Optional[str] = Query(None, description="YYYY-MM"),
    l1:            Optional[str] = None,
    account:       Optional[str] = None,
    search:        Optional[str] = None,
    show_internal: Optional[int] = 0,
    limit:         int = 500,
    offset:        int = 0,
    _user = Depends(require_auth)
):
    with db.get_conn() as conn:
        where  = [] if show_internal else ["is_internal = 0"]
        params = []

        if month:
            where.append("date LIKE ?")
            params.append(f"{month}%")
        if l1:
            where.append("l1 = ?")
            params.append(l1)
        if account:
            where.append("account_id = ?")
            params.append(account)
        if search:
            where.append("(merchant_clean LIKE ? OR raw_text LIKE ?)")
            params += [f"%{search}%", f"%{search}%"]

        sql = f"""
            SELECT t.*, a.name as account_name
            FROM transactions t
            LEFT JOIN accounts a ON t.account_id = a.id
            WHERE {' AND '.join(where)}
            ORDER BY date DESC, id DESC
            LIMIT ? OFFSET ?
        """
        params += [limit, offset]
        rows = conn.execute(sql, params).fetchall()

        total = conn.execute(
            f"SELECT COUNT(*) FROM transactions t WHERE {' AND '.join(where)}",
            params[:-2]
        ).fetchone()[0]

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "transactions": [dict(r) for r in rows]
    }


@app.get("/api/transactions/{tx_id}/rule")
def get_transaction_rule(tx_id: str, _user = Depends(require_auth)):
    """Find the rule that would match this transaction."""
    with db.get_conn() as conn:
        tx = conn.execute(
            "SELECT merchant_clean, raw_text FROM transactions WHERE id=?", (tx_id,)
        ).fetchone()
        if not tx:
            raise HTTPException(404, "Transaction not found")
        result = db.apply_rules(tx["merchant_clean"], tx["raw_text"])
        if result and result.get("rule_id"):
            rule = conn.execute(
                "SELECT * FROM rules WHERE id=?", (result["rule_id"],)
            ).fetchone()
            if rule:
                return {"rule": dict(rule)}
    return {"rule": None}


@app.patch("/api/transactions/{tx_id}")
def update_transaction(
    tx_id: str,
    body: dict,
    _user = Depends(require_auth)
):
    """Update category / merchant on a transaction. Sets manually_reviewed=1."""
    allowed = {"l1", "l2", "merchant_clean", "is_recurring", "is_sub"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(400, "No valid fields to update")

    updates["manually_reviewed"] = 1
    updates["id"] = tx_id

    set_clause = ", ".join(f"{k} = :{k}" for k in updates if k != "id")
    with db.get_conn() as conn:
        conn.execute(
            f"UPDATE transactions SET {set_clause} WHERE id = :id", updates
        )
    return {"ok": True}


# ── Review (unclassified) ──────────────────────────────────────────────────

@app.get("/api/review")
def get_unclassified(_user = Depends(require_auth)):
    with db.get_conn() as conn:
        rows = conn.execute("""
            SELECT t.*, a.name as account_name
            FROM transactions t
            LEFT JOIN accounts a ON t.account_id = a.id
            WHERE (t.l1 = '' OR t.l1 IS NULL)
              AND t.is_internal = 0
            ORDER BY t.date DESC
            LIMIT 500
        """).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/review/{tx_id}/approve")
def approve_transaction(
    tx_id: str,
    body: dict,
    _user = Depends(require_auth)
):
    """
    Approve categorization:
    - Update transaction + set manually_reviewed=1
    - Save rule to DB
    - Optionally apply rule retrospectively
    """
    l1       = body.get("l1", "")
    l2       = body.get("l2", "")
    keyword  = body.get("keyword", "")
    apply_retrospective = body.get("apply_retrospective", False)

    if not l1:
        raise HTTPException(400, "l1 is required")

    # Get transaction for merchant name
    with db.get_conn() as conn:
        tx = conn.execute(
            "SELECT * FROM transactions WHERE id = ?", (tx_id,)
        ).fetchone()
        if not tx:
            raise HTTPException(404, "Transaction not found")

        # Update this transaction
        conn.execute("""
            UPDATE transactions
            SET l1=?, l2=?, manually_reviewed=1
            WHERE id=?
        """, (l1, l2, tx_id))

        # Save rule
        merchant = dict(tx)["merchant_clean"] or ""
        conn.execute("""
            INSERT INTO rules (merchant, keyword, l1, l2, priority)
            VALUES (?, ?, ?, ?, 500)
        """, (merchant, keyword, l1, l2))

        retro_count = 0
        if apply_retrospective:
            # Apply to all non-reviewed transactions with same merchant
            q_params = [l1, l2, f"%{merchant}%"]
            kw_clause = ""
            if keyword:
                kw_clause = "AND raw_text LIKE ?"
                q_params.append(f"%{keyword}%")
            q_params.append(tx_id)

            cur = conn.execute(f"""
                UPDATE transactions
                SET l1=?, l2=?
                WHERE merchant_clean LIKE ?
                  {kw_clause}
                  AND manually_reviewed = 0
                  AND id != ?
            """, q_params)
            retro_count = cur.rowcount

    return {"ok": True, "retro_updated": retro_count}


@app.get("/api/review/{tx_id}/suggest")
async def suggest_category(tx_id: str, _user = Depends(require_auth)):
    """Ask Claude for a category suggestion for a single unclassified transaction."""
    import anthropic
    import json
    from normalizer import anonymize_for_api

    with db.get_conn() as conn:
        tx = conn.execute(
            "SELECT * FROM transactions WHERE id = ?", (tx_id,)
        ).fetchone()
        if not tx:
            raise HTTPException(404, "Transaction not found")

    tx = dict(tx)
    taxonomy = db.get_taxonomy()
    l1_list  = list(taxonomy.keys())
    anon_text = anonymize_for_api(tx["raw_text"] or "")
    merchant  = tx["merchant_clean"] or ""

    prompt = f"""You are a household budget categorization assistant for a Swiss family in Muttenz, Switzerland.
Common Swiss merchants: Migros/Coop=groceries, SBB=public transport, Digital Republic=telecom/SIM,
Parcandi/Parkingpay=parking, Assura/CSS/Helsana=health insurance, BLKB=bank.

Available L1 categories: {', '.join(l1_list)}
Available L2 per L1: {json.dumps(taxonomy)}

Transaction:
- Merchant: {merchant}
- Booking text (anonymised): {anon_text}

Respond with JSON only, no explanation:
{{"l1": "...", "l2": "...", "confidence": 0.0-1.0, "reasoning": "one sentence"}}
"""

    try:
        client   = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        response = client.messages.create(
            model      = "claude-sonnet-4-20250514",
            max_tokens = 200,
            messages   = [{"role": "user", "content": prompt}]
        )
        text   = response.content[0].text.strip()
        result = json.loads(text)
    except Exception as e:
        return {"error": str(e)}

    return result


@app.post("/api/review/suggest-all")
async def suggest_all(_user = Depends(require_auth)):
    """
    Batch AI categorization in chunks of 30 to avoid token limits.
    Returns {tx_id: {l1, l2, confidence}} dict.
    """
    import anthropic
    import json
    from normalizer import anonymize_for_api

    with db.get_conn() as conn:
        txs = conn.execute("""
            SELECT id, raw_text, merchant_clean, amount
            FROM transactions
            WHERE (l1 = '' OR l1 IS NULL)
              AND is_internal = 0
            ORDER BY date DESC
            LIMIT 200
        """).fetchall()

    if not txs:
        return {}

    txs = [dict(t) for t in txs]
    taxonomy = db.get_taxonomy()
    l1_list  = list(taxonomy.keys())

    merchant_to_ids = {}
    for tx in txs:
        m = tx["merchant_clean"] or "Unknown"
        merchant_to_ids.setdefault(m, []).append(tx["id"])

    merchants = list(merchant_to_ids.keys())
    client    = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    output    = {}
    CHUNK     = 30

    for chunk_start in range(0, len(merchants), CHUNK):
        chunk = merchants[chunk_start:chunk_start + CHUNK]
        ml    = []
        for i, merchant in enumerate(chunk):
            tx   = next(t for t in txs if t["id"] == merchant_to_ids[merchant][0])
            anon = anonymize_for_api(tx["raw_text"] or "")
            ml.append(f'{i+1}. merchant="{merchant}" text="{anon[:60]}"')

        prompt = f"""Categorize each merchant for a Swiss family budget in Muttenz.
Swiss context: Migros/Coop=groceries, SBB=transport, Apotheke=pharmacy,
Coiffeur=hairdresser, Tankstelle=fuel, Spanish merchants (Marbella/Banus/Malaga)=holiday area.

L1 categories: {', '.join(l1_list)}
L2 per L1: {json.dumps(taxonomy)}

Return a JSON array with exactly {len(chunk)} objects in order:
[{{"merchant":"...","l1":"...","l2":"...","confidence":0.0}}]

Merchants:
{chr(10).join(ml)}

Return ONLY the JSON array."""

        try:
            response = client.messages.create(
                model      = "claude-sonnet-4-20250514",
                max_tokens = 1500,
                messages   = [{"role": "user", "content": prompt}]
            )
            text = response.content[0].text.strip()
            text = text.replace("```json","").replace("```","").strip()
            results = json.loads(text)
        except json.JSONDecodeError:
            try:
                text = text[:text.rfind("},")+1] + "]"
                results = json.loads(text)
            except Exception:
                continue
        except Exception:
            continue

        for i, res in enumerate(results):
            if i >= len(chunk):
                break
            merchant = chunk[i]
            for tx_id in merchant_to_ids[merchant]:
                output[tx_id] = {
                    "l1":        res.get("l1", ""),
                    "l2":        res.get("l2", ""),
                    "confidence":res.get("confidence", 0),
                    "merchant":  merchant,
                }

    return output


# ── Rules ──────────────────────────────────────────────────────────────────

@app.get("/api/rules")
def get_rules(_user = Depends(require_auth)):
    return db.get_rules(active_only=False)


@app.post("/api/rules")
def create_rule(body: dict, _user = Depends(require_auth)):
    required = {"merchant", "l1"}
    if not required.issubset(body):
        raise HTTPException(400, "merchant and l1 are required")
    with db.get_conn() as conn:
        cur = conn.execute("""
            INSERT INTO rules (merchant, keyword, l1, l2, priority,
                               amount_min, amount_max, is_recurring)
            VALUES (:merchant, :keyword, :l1, :l2, :priority,
                    :amount_min, :amount_max, :is_recurring)
        """, {
            "merchant":    body["merchant"],
            "keyword":     body.get("keyword", ""),
            "l1":          body["l1"],
            "l2":          body.get("l2", ""),
            "priority":    body.get("priority", 500),
            "amount_min":  body.get("amount_min"),
            "amount_max":  body.get("amount_max"),
            "is_recurring": body.get("is_recurring", 0),
        })
        return {"id": cur.lastrowid, "ok": True}


@app.patch("/api/rules/{rule_id}")
def update_rule(rule_id: int, body: dict, _user = Depends(require_auth)):
    allowed = {"merchant", "keyword", "l1", "l2", "priority",
               "amount_min", "amount_max", "is_recurring", "active"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(400, "No valid fields")
    updates["id"] = rule_id
    set_clause = ", ".join(f"{k} = :{k}" for k in updates if k != "id")
    with db.get_conn() as conn:
        conn.execute(
            f"UPDATE rules SET {set_clause}, updated_at=datetime('now') WHERE id=:id",
            updates
        )
    return {"ok": True}


@app.delete("/api/rules/{rule_id}")
def delete_rule(rule_id: int, _user = Depends(require_auth)):
    with db.get_conn() as conn:
        conn.execute("DELETE FROM rules WHERE id=?", (rule_id,))
    return {"ok": True}


@app.post("/api/rules/recategorize")
def trigger_recategorize(_user = Depends(require_auth)):
    """Re-apply all rules to non-reviewed transactions."""
    updated = db.recategorize_all()
    return {"updated": updated}


@app.get("/api/rules/test")
def test_rule(
    text: str,
    _user = Depends(require_auth)
):
    """Test which rule matches a given booking text."""
    from normalizer import detect_tx_type, extract_merchant_blkb
    tx_type  = detect_tx_type(text)
    merchant = extract_merchant_blkb(text, tx_type)
    result   = db.categorize_transaction(text, merchant, 0)
    return {
        "merchant_extracted": merchant,
        "tx_type":            tx_type,
        "matched_rule_id":    result["rule_id"],
        "l1":                 result["l1"],
        "l2":                 result["l2"],
    }


# ── Dashboard ──────────────────────────────────────────────────────────────

@app.get("/api/dashboard")
def get_dashboard(month: Optional[str] = None, _user = Depends(require_auth)):
    """KPIs + category totals for a given period (month, quarter prefix, or year)."""
    from datetime import datetime as dt
    if not month:
        month = dt.now().strftime("%Y-%m")

    # Determine date prefix and trend anchor
    # month can be: "2025-03" (month), "2025" (year), "2025-04" with 3-month range (quarter)
    date_prefix = f"{month}%"
    is_year  = len(month) == 4
    is_month = len(month) == 7

    # For trend: always show last 12 months relative to end of period
    if is_year:
        trend_anchor = f"{month}-12-01"
    else:
        trend_anchor = f"{month}-01"

    with db.get_conn() as conn:
        # Income / expenses / balance
        summary = conn.execute("""
            SELECT
              COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS income,
              COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) AS expenses,
              COALESCE(SUM(amount), 0) AS balance,
              COUNT(*) AS tx_count
            FROM transactions
            WHERE date LIKE ? AND is_internal = 0
        """, (f"{month}%",)).fetchone()

        # By L1
        by_l1 = conn.execute("""
            SELECT l1, SUM(amount) AS total, COUNT(*) AS count
            FROM transactions
            WHERE date LIKE ? AND is_internal = 0 AND l1 != '' AND amount < 0
            GROUP BY l1
            ORDER BY total ASC
        """, (f"{month}%",)).fetchall()

        # Top merchants
        top_merchants = conn.execute("""
            SELECT merchant_clean, l1, SUM(amount) AS total, COUNT(*) AS count
            FROM transactions
            WHERE date LIKE ? AND is_internal = 0 AND amount < 0
            GROUP BY merchant_clean
            ORDER BY total ASC
            LIMIT 10
        """, (f"{month}%",)).fetchall()

        # Monthly trend (last 12 months)
        trend = conn.execute("""
            SELECT substr(date,1,7) AS month, l1,
                   SUM(amount) AS total
            FROM transactions
            WHERE date >= date(?, '-12 months')
              AND is_internal = 0
              AND amount < 0
              AND l1 != ''
            GROUP BY month, l1
            ORDER BY month ASC
        """, (trend_anchor,)).fetchall()

        # Unclassified count
        unclassified = conn.execute("""
            SELECT COUNT(*) FROM transactions
            WHERE (l1 = '' OR l1 IS NULL) AND is_internal = 0
        """).fetchone()[0]

    return {
        "month":          month,
        "income":         dict(summary)["income"],
        "expenses":       dict(summary)["expenses"],
        "balance":        dict(summary)["balance"],
        "tx_count":       dict(summary)["tx_count"],
        "unclassified":   unclassified,
        "by_l1":          [dict(r) for r in by_l1],
        "top_merchants":  [dict(r) for r in top_merchants],
        "trend":          [dict(r) for r in trend],
    }


# ── Analysis ───────────────────────────────────────────────────────────────

@app.get("/api/analysis/breakdown")
def get_breakdown(year: Optional[str] = None, _user = Depends(require_auth)):
    """
    Hierarchical breakdown: L1 → L2 → Merchant
    Returns aggregated counts and amounts for pivot-style analysis.
    """
    with db.get_conn() as conn:
        where  = "is_internal = 0"
        params = []
        if year and year != "all":
            where += " AND date LIKE ?"
            params.append(f"{year}%")

        # Available years
        years = [r[0] for r in conn.execute(
            "SELECT DISTINCT substr(date,1,4) FROM transactions WHERE is_internal=0 ORDER BY 1"
        ).fetchall()]

        # L1 totals
        l1_rows = conn.execute(f"""
            SELECT l1, COUNT(*) as cnt, SUM(amount) as amt
            FROM transactions
            WHERE {where} AND l1 != '' AND l1 IS NOT NULL
            GROUP BY l1
            ORDER BY SUM(amount) ASC
        """, params).fetchall()

        # L2 totals
        l2_rows = conn.execute(f"""
            SELECT l1, l2, COUNT(*) as cnt, SUM(amount) as amt
            FROM transactions
            WHERE {where} AND l1 != '' AND l1 IS NOT NULL
            GROUP BY l1, l2
            ORDER BY l1, SUM(amount) ASC
        """, params).fetchall()

        # Merchant totals (top 10 per L2)
        m_rows = conn.execute(f"""
            SELECT l1, l2, merchant_clean, COUNT(*) as cnt, SUM(amount) as amt
            FROM transactions
            WHERE {where} AND l1 != '' AND l1 IS NOT NULL
            GROUP BY l1, l2, merchant_clean
            ORDER BY l1, l2, SUM(amount) ASC
        """, params).fetchall()

        # Unclassified
        uncat = conn.execute(f"""
            SELECT COUNT(*) as cnt, SUM(amount) as amt
            FROM transactions
            WHERE {where} AND (l1 = '' OR l1 IS NULL)
        """, params).fetchone()

        # Grand total
        grand = conn.execute(f"""
            SELECT COUNT(*) as cnt, SUM(amount) as amt
            FROM transactions WHERE {where}
        """, params).fetchone()

    # Build hierarchy
    merchants = {}
    for r in m_rows:
        key = (r["l1"], r["l2"])
        merchants.setdefault(key, []).append({
            "merchant": r["merchant_clean"],
            "cnt": r["cnt"],
            "amt": round(r["amt"], 2)
        })

    l2_map = {}
    for r in l2_rows:
        l2_map.setdefault(r["l1"], []).append({
            "l2":  r["l2"],
            "cnt": r["cnt"],
            "amt": round(r["amt"], 2),
            "merchants": merchants.get((r["l1"], r["l2"]), [])[:15]
        })

    result = []
    for r in l1_rows:
        result.append({
            "l1":  r["l1"],
            "cnt": r["cnt"],
            "amt": round(r["amt"], 2),
            "l2":  l2_map.get(r["l1"], [])
        })

    return {
        "years":       years,
        "year":        year or "all",
        "breakdown":   result,
        "unclassified": {"cnt": uncat["cnt"], "amt": round(uncat["amt"] or 0, 2)},
        "grand":       {"cnt": grand["cnt"], "amt": round(grand["amt"] or 0, 2)},
    }


# ── Taxonomy ───────────────────────────────────────────────────────────────

@app.get("/api/taxonomy")
def get_taxonomy(_user = Depends(require_auth)):
    return db.get_taxonomy()


@app.post("/api/taxonomy")
def add_taxonomy(body: dict, _user = Depends(require_auth)):
    l1 = body.get("l1", "").strip()
    l2 = body.get("l2", "").strip()
    if not l1 or not l2:
        raise HTTPException(400, "l1 and l2 required")
    with db.get_conn() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO taxonomy (l1, l2) VALUES (?, ?)", (l1, l2)
        )
    return {"ok": True}


@app.patch("/api/taxonomy/rename")
def rename_taxonomy(body: dict, _user = Depends(require_auth)):
    db.rename_category(
        body["old_l1"], body.get("old_l2"),
        body["new_l1"], body.get("new_l2")
    )
    return {"ok": True}


@app.delete("/api/taxonomy")
def delete_taxonomy(body: dict, _user = Depends(require_auth)):
    db.delete_l2(
        body["l1"], body["l2"],
        body["move_to_l1"], body["move_to_l2"]
    )
    return {"ok": True}


# ── Accounts ───────────────────────────────────────────────────────────────

@app.get("/api/accounts")
def get_accounts(_user = Depends(require_auth)):
    with db.get_conn() as conn:
        rows = conn.execute("SELECT * FROM accounts ORDER BY owner, name").fetchall()
    return [dict(r) for r in rows]


@app.get("/api/accounts/coverage")
def get_coverage(_user = Depends(require_auth)):
    """Return date coverage (min/max transaction date) per account."""
    with db.get_conn() as conn:
        rows = conn.execute("""
            SELECT
                a.id, a.name, a.owner, a.bank,
                MIN(t.date) as date_from,
                MAX(t.date) as date_to,
                COUNT(t.id) as tx_count
            FROM accounts a
            LEFT JOIN transactions t ON t.account_id = a.id
            GROUP BY a.id
            ORDER BY a.owner, a.name
        """).fetchall()
    return [dict(r) for r in rows]


# ── Import history ─────────────────────────────────────────────────────────

@app.get("/api/imports")
def get_imports(_user = Depends(require_auth)):
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM imports ORDER BY imported_at DESC LIMIT 50"
        ).fetchall()
    return [dict(r) for r in rows]


# ── Excel export ───────────────────────────────────────────────────────────

@app.get("/api/export/excel")
def export_excel(
    year: Optional[str] = None,
    month: Optional[str] = None,
    _user = Depends(require_auth)
):
    from datetime import datetime as dt
    import io
    import xlsxwriter

    with db.get_conn() as conn:
        where  = ["is_internal = 0"]
        params = []
        if month:
            where.append("date LIKE ?")
            params.append(f"{month}%")
        elif year and year != "all":
            where.append("date LIKE ?")
            params.append(f"{year}%")

        rows = conn.execute(f"""
            SELECT t.date, a.name as account, t.merchant_clean, t.l1, t.l2,
                   t.amount, t.currency, t.is_recurring, t.manually_reviewed,
                   t.raw_text
            FROM transactions t
            LEFT JOIN accounts a ON t.account_id = a.id
            WHERE {' AND '.join(where)}
            ORDER BY t.date ASC
        """, params).fetchall()

    # Build Excel
    output = io.BytesIO()
    wb     = xlsxwriter.Workbook(output, {"in_memory": True})
    ws     = wb.add_worksheet("Ledger")

    headers = ["Date", "Account", "Merchant", "L1", "L2", "Amount (CHF)",
               "Currency", "Recurring", "Reviewed", "Raw Text"]

    bold      = wb.add_format({"bold": True, "bg_color": "#f0f2f5"})
    date_fmt  = wb.add_format({"num_format": "YYYY-MM-DD"})
    money     = wb.add_format({"num_format": '#,##0.00'})
    red       = wb.add_format({"num_format": '#,##0.00', "font_color": "#dc2626"})
    green     = wb.add_format({"num_format": '#,##0.00', "font_color": "#16a34a"})

    for col, h in enumerate(headers):
        ws.write(0, col, h, bold)

    for row_idx, row in enumerate(rows, start=1):
        d = dict(row)
        # Write date as real Excel date
        try:
            from datetime import datetime as dt2
            ws.write_datetime(row_idx, 0, dt2.strptime(d["date"], "%Y-%m-%d"), date_fmt)
        except Exception:
            ws.write(row_idx, 0, d["date"])
        ws.write(row_idx, 1, d["account"] or "")
        ws.write(row_idx, 2, d["merchant_clean"] or "")
        ws.write(row_idx, 3, d["l1"] or "")
        ws.write(row_idx, 4, d["l2"] or "")
        fmt = red if d["amount"] < 0 else green
        ws.write(row_idx, 5, d["amount"], fmt)
        ws.write(row_idx, 6, d["currency"])
        ws.write(row_idx, 7, "Yes" if d["is_recurring"] else "")
        ws.write(row_idx, 8, "Yes" if d["manually_reviewed"] else "")
        ws.write(row_idx, 9, d["raw_text"] or "")

    ws.set_column(0, 0, 12)
    ws.set_column(1, 1, 18)
    ws.set_column(2, 2, 28)
    ws.set_column(3, 4, 20)
    ws.set_column(5, 5, 14)
    ws.set_column(9, 9, 60)
    ws.freeze_panes(1, 0)

    # ── Taxonomy sheet ─────────────────────────────────────────────────────
    wt   = wb.add_worksheet("Taxonomy")
    tax  = db.get_taxonomy()
    wt.write(0, 0, "L1", bold)
    wt.write(0, 1, "L2", bold)
    wt.set_column(0, 0, 22)
    wt.set_column(1, 1, 26)
    tax_row = 1
    for l1 in sorted(tax.keys()):
        for l2 in sorted(tax[l1]):
            wt.write(tax_row, 0, l1)
            wt.write(tax_row, 1, l2)
            tax_row += 1

    wb.close()
    output.seek(0)

    period = month or str(year) if year else "all"
    tmp    = f"/tmp/homebudget_export_{period}.xlsx"
    with open(tmp, "wb") as f:
        f.write(output.read())

    return FileResponse(
        tmp,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=f"homebudget_{period}.xlsx"
    )


# ── Frontend (React SPA) ───────────────────────────────────────────────────
# In production the React build is served from /app/static
if os.path.isdir("/app/static"):
    app.mount("/", StaticFiles(directory="/app/static", html=True), name="static")
