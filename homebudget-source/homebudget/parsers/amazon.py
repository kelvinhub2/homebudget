"""
parsers/amazon.py — Amazon order history CSV parser

File format (Chrome addon export):
  - Comma-delimited, header: order id, order url, order date, quantity,
    description, item url, price, subscribe & save, ASIN
  - Currency embedded in price field: "€ 17.98", "£ 6.99", "$ 12.00"
  - Multiple items per order (same order id = separate transactions)
  - Duplicate header rows possible (Chrome addon artefact) — filtered
  - Marketplace detected from order ID prefix:
      303- / 028- = DE
      026- / 202- = UK
      113- / 114- / 1-- = US
"""
import re
import csv
from datetime import datetime

from normalizer import extract_merchant_amazon
from db import make_tx_id


CURRENCY_SYMBOLS = {
    "€": "EUR",
    "£": "GBP",
    "$": "USD",
    "CHF": "CHF",
}

MARKETPLACE_MAP = {
    "303": "DE", "028": "DE",
    "026": "UK", "202": "UK",
    "113": "US", "114": "US",
}


def detect_marketplace(order_id: str) -> str:
    prefix = order_id.split("-")[0]
    return MARKETPLACE_MAP.get(prefix, "DE")


def parse_price(price_str: str) -> tuple[float, str]:
    """
    Parse "€ 17.98" → (17.98, "EUR")
    Returns (amount, currency_code)
    """
    price_str = price_str.strip()
    for symbol, code in CURRENCY_SYMBOLS.items():
        if symbol in price_str:
            amount_str = price_str.replace(symbol, "").strip()
            # Handle both comma and period as decimal separator
            amount_str = amount_str.replace(",", ".")
            try:
                return float(amount_str), code
            except ValueError:
                pass
    # No symbol — try raw number, assume EUR
    try:
        return float(price_str.replace(",", ".")), "EUR"
    except ValueError:
        return 0.0, "EUR"


def convert_to_chf(amount: float, currency: str, year: int, fx_rates: dict) -> float:
    """Convert foreign currency to CHF using annual average rates."""
    if currency == "CHF":
        return amount
    year_str = str(year)
    rates = fx_rates.get(currency, {})
    # Use exact year if available, else latest available
    rate = rates.get(year_str) or rates.get(max(rates.keys(), key=int))
    if rate:
        return round(amount * float(rate), 2)
    return amount  # fallback: no conversion


def is_amazon_file(filepath: str) -> bool:
    """Detect Amazon CSV by header."""
    try:
        with open(filepath, "r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            headers = [h.lower().strip() for h in (reader.fieldnames or [])]
            return "order id" in headers and "description" in headers and "price" in headers
    except Exception:
        return False


def parse(filepath: str, account_id: str, import_id: int,
          fx_rates: dict) -> list[dict]:
    """
    Parse Amazon order history CSV.
    Returns list of transaction dicts ready for insert_transaction().
    """
    transactions = []
    seen_header = False

    with open(filepath, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)

        for row in reader:
            order_id = (row.get("order id") or "").strip()

            # Filter duplicate header rows (Chrome addon artefact)
            if order_id.lower() == "order id":
                continue
            if not order_id:
                continue

            date_raw    = (row.get("order date") or "").strip()
            description = (row.get("description") or "").strip()
            price_raw   = (row.get("price") or "0").strip()
            qty_raw     = (row.get("quantity") or "1").strip()
            subscribe   = (row.get("subscribe & save") or "0").strip()
            asin        = (row.get("ASIN") or "").strip()

            if not date_raw or not price_raw:
                continue

            # Parse date
            try:
                date_str = datetime.strptime(date_raw, "%d.%m.%Y").strftime("%Y-%m-%d")
            except ValueError:
                try:
                    date_str = datetime.fromisoformat(date_raw).strftime("%Y-%m-%d")
                except Exception:
                    date_str = date_raw[:10]

            year = int(date_str[:4])

            # Parse price and currency
            amount_orig, currency_orig = parse_price(price_raw)
            if amount_orig == 0:
                continue

            # Convert to CHF
            amount_chf = convert_to_chf(amount_orig, currency_orig, year, fx_rates)

            # Marketplace
            marketplace = detect_marketplace(order_id)
            source_label = f"Amazon {marketplace}"

            # Merchant = product description (Claude will categorize)
            merchant = extract_merchant_amazon(description, marketplace)

            # Subscription
            is_sub = 1 if str(subscribe).strip() not in ("0", "", "False", "false") else 0
            is_recurring = is_sub

            # Raw text includes order ID for traceability
            raw_text = f"{source_label} | {order_id} | {description}"

            tx_id = make_tx_id(source_label, date_str, -amount_chf, description)

            transactions.append({
                "id":            tx_id,
                "date":          date_str,
                "account_id":    account_id,
                "amount":        -amount_chf,      # always debit
                "currency":      "CHF",
                "amount_orig":   amount_orig,
                "currency_orig": currency_orig if currency_orig != "CHF" else None,
                "fx_rate":       None,             # FX applied via annual rate
                "raw_text":      raw_text,
                "merchant_clean": merchant,
                "tx_type":       "CARD",
                "l1":            "",
                "l2":            "",
                "is_recurring":  is_recurring,
                "is_sub":        is_sub,
                "is_internal":   0,
                "import_id":     import_id,
            })

    return transactions
