"""
parsers/detect.py — Auto-detect file source type and dispatch to correct parser

Detection priority:
  1. Swisscard CSV   — header contains TransactionId + CardId
  2. Swisscard XLSX  — header contains Transaction date + Merchant
  3. UBS CSV         — header contains Abschlussdatum + IBAN, or Kartennummer + Branche
  4. Amazon CSV      — header contains order id + description + price
  5. BLKB XLSX       — header contains Buchungstext + Belastungsbetrag
  6. Unknown         — returned as None, triggers user review
"""
import os

from parsers.blkb      import is_blkb_file, extract_iban_from_filename
from parsers.swisscard import is_swisscard_file, extract_card_id
from parsers.amazon    import is_amazon_file
from parsers.ubs       import is_ubs_file, extract_account_key as ubs_account_key
from parsers.cs        import is_cs_file, extract_iban as cs_extract_iban


SOURCE_BLKB      = "BLKB"
SOURCE_SWISSCARD = "Swisscard"
SOURCE_AMAZON    = "Amazon"
SOURCE_UBS       = "UBS"
SOURCE_CS        = "CS"
SOURCE_UNKNOWN   = "Unknown"


def detect_source(filepath: str) -> dict:
    """
    Detect source type and extract account key.
    Returns:
      {
        "source":      "BLKB" | "Swisscard" | "UBS" | "Amazon" | "Unknown",
        "account_key": str,
        "error":       str | None
      }
    """
    ext = os.path.splitext(filepath)[1].lower()

    try:
        if ext in (".csv",):
            if is_swisscard_file(filepath):
                card_id = extract_card_id(filepath)
                return {"source": SOURCE_SWISSCARD, "account_key": card_id, "error": None}
            if is_ubs_file(filepath):
                key = ubs_account_key(filepath)
                return {"source": SOURCE_UBS, "account_key": key, "error": None}
            if is_amazon_file(filepath):
                return {"source": SOURCE_AMAZON, "account_key": "amazon", "error": None}

        if ext in (".xlsx", ".xlsm"):
            if is_swisscard_file(filepath):
                card_id = extract_card_id(filepath)
                return {"source": SOURCE_SWISSCARD, "account_key": card_id, "error": None}
            if is_cs_file(filepath):
                iban = cs_extract_iban(filepath)
                return {"source": SOURCE_CS, "account_key": iban, "error": None}
            if is_blkb_file(filepath):
                iban = extract_iban_from_filename(filepath)
                return {"source": SOURCE_BLKB, "account_key": iban, "error": None}

    except Exception as e:
        return {"source": SOURCE_UNKNOWN, "account_key": "", "error": str(e)}

    return {"source": SOURCE_UNKNOWN, "account_key": "", "error": "File format not recognized"}
