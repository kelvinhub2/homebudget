"""
parsers/ubs.py — UBS CSV parser (two formats)

Format A — UBS Privatkonto / Sparkonto:
  - UTF-8-SIG, semicolon-delimited
  - 9-line header with IBAN
  - Data rows wrapped in outer double-quotes
  - Inner fields with semicolons are escaped as ""field""
  - Columns: Abschlussdatum;Abschlusszeit;Buchungsdatum;Valutadatum;
             Währung;Belastung;Gutschrift;Einzelbetrag;Saldo;Transaktions-Nr.;
             Beschreibung1;Beschreibung2;Beschreibung3;Fussnoten

Format B — UBS Platinum CC:
  - CP1252 encoding, semicolon-delimited
  - 1-line "sep=;" header, then column header
  - Columns: Kontonummer;Kartennummer;Konto-/Karteninhaber;Einkaufsdatum;
             Buchungstext;Branche;Betrag;Originalwährung;Kurs;Währung;
             Belastung;Gutschrift;Buchung
"""
import re
import csv
import io
from datetime import datetime

from normalizer import extract_merchant_blkb, detect_tx_type, strip_noise
from db import make_tx_id


# ── Detection ─────────────────────────────────────────────────────────────

def is_ubs_file(filepath: str) -> bool:
    """Detect UBS CSV by header content."""
    try:
        # Try Format A (UTF-8)
        with open(filepath, encoding='utf-8-sig', errors='replace') as f:
            head = f.read(500)
        if 'Abschlussdatum' in head and ('IBAN:' in head or 'Abschlusszeit' in head):
            return True
        # Try Format B (CP1252 Platinum CC)
        with open(filepath, encoding='cp1252', errors='replace') as f:
            head = f.read(300)
        if 'Kartennummer' in head and 'Buchungstext' in head and 'Branche' in head:
            return True
    except Exception:
        pass
    return False


def _is_format_b(filepath: str) -> bool:
    """True if file is UBS Platinum CC format."""
    try:
        with open(filepath, encoding='cp1252', errors='replace') as f:
            head = f.read(300)
        return 'Kartennummer' in head and 'Branche' in head
    except Exception:
        return False


# ── Account key extraction ─────────────────────────────────────────────────

def extract_account_key(filepath: str) -> str:
    """Extract IBAN or card number from file header."""
    try:
        if _is_format_b(filepath):
            # Platinum CC: card number from first data row
            with open(filepath, encoding='cp1252', errors='replace') as f:
                content = f.read()
            lines = content.split('\n')
            for line in lines:
                m = re.search(r'(\d{4}\s+\d{4}\s+\d{2}XX\s+XXXX\s+\d{4})', line)
                if m:
                    # Return last 4 digits
                    digits = re.sub(r'[^\d]', '', m.group(1))
                    return digits[-4:]
            # Try Kontonummer field
            import pandas as pd
            df = pd.read_csv(filepath, encoding='cp1252', sep=';',
                             skiprows=1, on_bad_lines='skip', nrows=2)
            if 'Kartennummer' in df.columns:
                card = str(df['Kartennummer'].iloc[0]).strip()
                return re.sub(r'[^\d]', '', card)[-4:]
        else:
            # Format A: IBAN from header
            with open(filepath, encoding='utf-8-sig', errors='replace') as f:
                head = f.read(500)
            m = re.search(r'IBAN:;(CH[\d\s]+B?)', head)
            if m:
                return re.sub(r'[\s B]', '', m.group(1))
    except Exception:
        pass
    return ""


# ── Parsing ────────────────────────────────────────────────────────────────

def parse(filepath: str, account_id: str, import_id: int) -> list[dict]:
    """Dispatch to correct format parser."""
    if _is_format_b(filepath):
        return _parse_format_b(filepath, account_id, import_id)
    return _parse_format_a(filepath, account_id, import_id)


def _parse_ubs_row_a(line: str) -> list[str]:
    """
    Parse one UBS Format A data row.
    Each row is wrapped in outer double-quotes.
    Inner quoted fields use \"\"...\"\" to escape.
    """
    line = line.strip()
    if line.startswith('"') and line.endswith('"'):
        line = line[1:-1]

    fields = []
    current = ''
    in_inner = False
    i = 0
    while i < len(line):
        if line[i:i+2] == '""':
            in_inner = not in_inner
            i += 2
            continue
        if line[i] == ';' and not in_inner:
            fields.append(current)
            current = ''
        else:
            current += line[i]
        i += 1
    fields.append(current)
    return fields


def _parse_format_a(filepath: str, account_id: str, import_id: int) -> list[dict]:
    """Parse UBS Privatkonto/Sparkonto CSV (Format A)."""
    import csv as csv_mod
    transactions = []

    with open(filepath, encoding='utf-8-sig', errors='replace') as f:
        raw = f.read()

    # Normalize line endings
    raw = raw.replace('\r\n', '\n').replace('\r', '\n')

    # Find data header line
    data_pos = raw.find('Abschlussdatum;')
    if data_pos < 0:
        return []

    header_end = raw.find('\n', data_pos)
    col_names  = raw[data_pos:header_end].strip().split(';')
    data_raw   = raw[header_end+1:]

    # Parse with standard CSV (fields with internal semicolons are quoted)
    reader = csv_mod.reader(data_raw.splitlines(), delimiter=';', quotechar='"')

    def col(row, name):
        try:
            idx = col_names.index(name)
            return row[idx].strip() if idx < len(row) else ''
        except ValueError:
            return ''

    for row in reader:
        if not row or not any(r.strip() for r in row):
            continue
        # Skip header repeat or summary lines
        if row[0].strip() in ('Abschlussdatum', ''):
            continue

        # Date
        date_raw = col(row, 'Abschlussdatum') or col(row, 'Buchungsdatum')
        if not date_raw or date_raw == 'Abschlussdatum':
            continue
        try:
            if '-' in date_raw:
                date_str = datetime.strptime(date_raw[:10], '%Y-%m-%d').strftime('%Y-%m-%d')
            else:
                date_str = datetime.strptime(date_raw[:10], '%d.%m.%Y').strftime('%Y-%m-%d')
        except Exception:
            continue

        # Amount
        belastung  = col(row, 'Belastung').replace("'", '').replace(',', '.').strip()
        gutschrift = col(row, 'Gutschrift').replace("'", '').replace(',', '.').strip()
        try:
            if belastung:
                amount = float(belastung)
            elif gutschrift:
                amount = float(gutschrift)
            else:
                continue
        except ValueError:
            continue

        # Raw text from descriptions
        desc1 = col(row, 'Beschreibung1')
        desc2 = col(row, 'Beschreibung2')
        desc3 = col(row, 'Beschreibung3')
        raw_text = ' | '.join(d for d in [desc1, desc2, desc3] if d.strip())

        # FX detection from Beschreibung3
        fx_rate    = None
        orig_amount = None
        orig_curr   = None
        if desc3:
            m = re.search(r'Devisenkurs:\s*([\d.]+)', desc3)
            if m:
                fx_rate = float(m.group(1))
            m = re.search(r'Kartentransaktionsbetrag:\s*(-?[\d.]+)\s+([A-Z]{3})', desc3)
            if m:
                orig_amount = float(m.group(1))
                orig_curr   = m.group(2)

        # Internal transfer detection
        is_internal = 0
        if re.search(r'Dauerauftrag|Übertrag|eigene\s+Konto|Umbuchung|Saldovortrag', raw_text, re.IGNORECASE):
            is_internal = 1
        # Large round transfers to own names
        if re.search(r'Schaer.*Sharifi|Sharifi.*Schaer', desc1, re.IGNORECASE):
            is_internal = 1

        # Merchant: use first part of desc1 before city/semicolon
        merchant_raw = desc1.split(';')[0].strip() if desc1 else ''
        merchant_clean = strip_noise(merchant_raw)
        # Remove booking codes and trailing city
        merchant_clean = re.sub(r'\s+\d{4,5}\s+.*$', '', merchant_clean).strip()
        if not merchant_clean or len(merchant_clean) < 2:
            tx_type = detect_tx_type(raw_text)
            merchant_clean = extract_merchant_blkb(raw_text, tx_type)
        merchant_clean = merchant_clean.title()

        is_sub = 1 if re.search(r'SUBSCR|ANNUAL|NETFLIX|SPOTIFY', raw_text, re.IGNORECASE) else 0

        tx_id = make_tx_id('UBS', date_str, amount, merchant_clean)

        transactions.append({
            'id':             tx_id,
            'date':           date_str,
            'account_id':     account_id,
            'amount':         amount,
            'currency':       'CHF',
            'amount_orig':    orig_amount,
            'currency_orig':  orig_curr if orig_curr and orig_curr != 'CHF' else None,
            'fx_rate':        fx_rate,
            'raw_text':       raw_text,
            'merchant_clean': merchant_clean,
            'tx_type':        'CARD' if 'Debitkarte' in desc2 else detect_tx_type(raw_text),
            'l1':             '',
            'l2':             '',
            'is_recurring':   0,
            'is_sub':         is_sub,
            'is_internal':    is_internal,
            'import_id':      import_id,
        })

    return transactions


def _parse_format_b(filepath: str, account_id: str, import_id: int) -> list[dict]:
    """Parse UBS Platinum CC CSV (Format B)."""
    import pandas as pd
    transactions = []

    try:
        df = pd.read_csv(filepath, encoding='cp1252', sep=';',
                         skiprows=1, on_bad_lines='skip')
    except Exception:
        return []

    # Drop summary rows (no Einkaufsdatum)
    df = df[df['Einkaufsdatum'].notna() & (df['Einkaufsdatum'] != '') &
            df['Kontonummer'].notna()].copy()

    for _, row in df.iterrows():
        # Date
        try:
            date_str = datetime.strptime(str(row['Einkaufsdatum']).strip()[:10],
                                         '%d.%m.%Y').strftime('%Y-%m-%d')
        except Exception:
            continue

        # Amount — Belastung is positive (debit), Gutschrift is positive (credit)
        try:
            belastung  = float(str(row.get('Belastung',  '')).replace(',', '.') or 0)
            gutschrift = float(str(row.get('Gutschrift', '')).replace(',', '.') or 0)
        except (ValueError, TypeError):
            continue

        if belastung:
            amount = -abs(belastung)
        elif gutschrift:
            amount = abs(gutschrift)
        else:
            continue

        # FX
        try:
            orig_amount = float(str(row.get('Betrag', '')).replace(',', '.'))
            orig_curr   = str(row.get('Originalwährung', '')).strip()
            fx_rate     = float(str(row.get('Kurs', '')).replace(',', '.'))
        except (ValueError, TypeError):
            orig_amount = None
            orig_curr   = None
            fx_rate     = None

        orig_curr = orig_curr if orig_curr and orig_curr != 'CHF' else None

        # Merchant from Buchungstext + Branche hint
        buchungstext = str(row.get('Buchungstext', '')).strip()
        branche      = str(row.get('Branche', '')).strip()
        raw_text     = buchungstext
        if branche and branche != 'nan':
            raw_text += f' | {branche}'

        merchant_clean = strip_noise(buchungstext.split()[0] if buchungstext else 'Unknown')
        # Take merchant name before flight code / city (2+ spaces or all-caps code)
        m = re.match(r'^([A-Z][A-Z0-9\s\.\*\-]+?)\s{2,}', buchungstext)
        if m:
            merchant_clean = strip_noise(m.group(1).strip()).title()
        elif buchungstext:
            # Remove trailing booking codes (6-char alphanumeric) and cities
            cleaned = re.sub(r'\s+[A-Z0-9]{6,}\s*.*$', '', buchungstext).strip()
            merchant_clean = strip_noise(cleaned).title() or strip_noise(buchungstext[:30]).title()

        if not merchant_clean:
            merchant_clean = 'Unknown'

        is_internal = 0
        is_sub      = 1 if re.search(r'SUBSCR|ANNUAL|NETFLIX|SPOTIFY', buchungstext, re.IGNORECASE) else 0

        tx_id = make_tx_id('UBS_CC', date_str, amount, merchant_clean)

        transactions.append({
            'id':             tx_id,
            'date':           date_str,
            'account_id':     account_id,
            'amount':         amount,
            'currency':       'CHF',
            'amount_orig':    orig_amount,
            'currency_orig':  orig_curr,
            'fx_rate':        fx_rate,
            'raw_text':       raw_text,
            'merchant_clean': merchant_clean,
            'tx_type':        'CARD',
            'l1':             '',
            'l2':             '',
            'is_recurring':   0,
            'is_sub':         is_sub,
            'is_internal':    is_internal,
            'import_id':      import_id,
        })

    return transactions
