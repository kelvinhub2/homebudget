"""
normalizer.py — Booking text normalisation and merchant extraction
Two-pass pipeline:
  Pass 1 — detect structural token (TWINT_MERCHANT, TWINT_P2P, CARD, etc.)
  Pass 2 — strip noise, extract clean merchant name
"""
import re
from typing import Optional


# ── Pass 1: Structural token detection ────────────────────────────────────

# Country/city suffixes to skip when extracting merchant name
_SKIP_LINES = re.compile(
    r'^(schweiz|switzerland|suisse|svizzera|france|deutschland|germany|'
    r'espana|spain|uk|england|austria|österreich|'
    r'[a-z\s]+(gmbh|ag|sa|sarl|ltd|inc|srl|bv|nv|plc)\s*$)',
    re.IGNORECASE
)

_COUNTRY_LINE = re.compile(
    r'^\s*(schweiz|switzerland|suisse|svizzera|france|deutschland|'
    r'espana|spain|uk|england|austria|österreich)\s*$',
    re.IGNORECASE
)

_POSTAL_LINE = re.compile(r'^\d{4,5}\s')  # postal code start


def detect_tx_type(raw: str) -> str:
    """
    Returns a structural token describing the transaction type.
    """
    r = raw.upper()
    # INTERNAL_TRANSFER: Dauerauftrag, own-account transfers
    if re.search(r'DAUERAUFTRAG|DA001000|INTERNAL', r):
        return "INTERNAL_TRANSFER"
    # CR-002: detect transfers via Mitteilung keyword
    if re.search(r'MITTEILUNG:\s*(TRANSFER|ÜBERTRAG|UMBUCHUNG|SAVINGS)', r):
        return "INTERNAL_TRANSFER"
    # TWINT
    if re.search(r'TWINT.{0,20}GELD (GESENDET|ERHALTEN)', r):
        return "TWINT_P2P"
    if re.search(r'\+41[0-9 ]{9,}', raw):
        return "TWINT_P2P"
    if "TWINT" in r and re.search(r'[A-Z]{3,}.*[A-Z]{3,}', r):
        return "TWINT_MERCHANT"
    if "TWINT" in r:
        return "TWINT_P2P"
    if re.search(r'MAESTRO|BANCOMAT', r):
        return "ATM"
    if re.search(r'DEBITKARTE|VISECA|CARD', r):
        return "CARD"
    if re.search(r'ZAHLUNGSEINGANG|GUTSCHRIFT', r):
        return "INCOMING"
    if re.search(r'ZINSZAHLUNG|AMORTISATION|HYPOTHEK', r):
        return "OTHER"
    return "OTHER"


# ── Pass 2: Noise removal ──────────────────────────────────────────────────

NOISE_PATTERNS = [
    r'Ref\.?-?Nr\.?\s*[\d\s]+',
    r'\b(CH|DE|FR|LI)\d{2}[\s\d]{10,}',
    r'ESR/QR Referenz:?\s*[\d\s]*',
    r'SCOR Referenz:?\s*[\w\s]*',
    r'Kartennummer\s+[\dXx\s]+',
    r'Karten-Nr\.?\s+[\dXx\s]+',
    r'\b\d{2}\.\d{2}\.\d{4}\b',
    r'\.\d{2}\.\d{4}\b',               # CR-023: partial date .MM.YYYY
    r'\b\d{2}\.\d{2}\.\d{2}\b',
    r'\b\d{2}:\d{2}\b',
    r'Zahlungsauftrag E-Banking\s*/',
    r'Zahlungsauftrag\s+QR-Rechnung\s*/',
    r'TWINT-Zahlung\s*/',
    r'Rückerstattung TWINT-Zahlung\s*/',
    r'Zahlungseingang\s*/',
    r'Zinszahlung\s*/',
    r'Zins-\s*/\s*Amortisationszahlung\s*/',
    r'Viseca Zahlung\s*/',
    r'Zahlungsauftrag eBill\s*/',
    r'Debitkarte (E-Commerce |)Zahlung (CHF|EUR)\s*',
    r'Debitkarte Zahlung Verkaufspunkt (CHF|EUR)\s*',
    r'Mitteilung:\s*',
    r'Info:\s*',
    r'Zahlbar durch:\s*',
    r'Geld (gesendet an|erhalten von)\s*',
    r'ESR:\s*[\d\-]+',
    r'RECHNUNG VOM\s*',
    r'Referenz:\s*[\w\-]+',
    r'LSVE-[\w\-]+',
    r'BC:\s*[\d\-]+',
    r'vom \d{2}\.\d{2}\.\d{2} um \d{2}:\d{2}',
    r'Originalbetrag\s+[A-Z]{2,4}\s+[\d\.,]+\.?',  # CR-023: FX amount incl trailing dot
    r'W[äa]hrungskurs\s+\d+\s+\w+\s*=\s*[\d\.,]*\s*\w*',  # Währungskurs 1 EUR = [value]
    r'\bDebitkarte\s+Zahlung\s+Ausland\s+(CHF|EUR|USD)\b',  # CARD foreign + currency
    r'\bDebitkarte\s+Zahlung\s+Ausland\b',
    r'\bWww\.\S+',                                # CR-023: URLs
    r'[A-Za-z]{3,}\s+\+41[\d\s]{9,}',           # phone numbers
    # Own name/address — all variants
    r'Manuel\s+Julien\s+Sch[äa]er?',
    r'Manuel\s+Sch[äa]er?',
    r'Farnaz\s+Sch[äa]er?',
    r'Sch[äa]er?\s+Manuel',
    r'Sch[äa]er?\s+Farnaz',
    r'Sharifi[\s-]Yazdi\s+Farnaz',
    r'[\s-]?Sharifi[\s-]Yazdi',
    r'Farnaz\s+Sharifi',
    r'Schaer\s+Manuel',
    r'M\.\s+Sch[äa]r',
    r'Herr\s+M\.\s+Sch[äa]r',
    r'\bSch[äa]er?\b',
    r'\bFarnaz\b',
    r'Tubhusweg\s+\d+',
    r'4132\s+Muttenz',
    r'DePuy\s+Synthes\s+(?:EMEA|GmbH|AG)?',
    r'Luzernstrasse\s+\d+',
    r'Hochstrasse\s+\d+',
    r'\d{4}\s+(?:Zuchwil|Schaffhausen|Winterthur|Bern|Zürich|Basel)',
]

_NOISE_RE = re.compile('|'.join(NOISE_PATTERNS), re.IGNORECASE)


def strip_noise(text: str) -> str:
    """Remove all noise patterns from text."""
    text = _NOISE_RE.sub(' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    text = re.sub(r'^[\s\-]+|[\s\-]+$', '', text).strip()
    return text


def _is_address_line(line: str) -> bool:
    """True if line looks like an address component to skip."""
    if _POSTAL_LINE.match(line):
        return True
    if _COUNTRY_LINE.match(line):
        return True
    # Short numbers-only lines
    if re.match(r'^\d+$', line):
        return True
    # Street-number patterns like "Hauptstrasse 12"
    if re.match(r'^[A-Za-zäöüÄÖÜ\s]+\s+\d+[a-z]?$', line) and len(line) < 30:
        return True
    return False


def extract_merchant_blkb(raw: str, tx_type: str) -> str:
    """
    Extract merchant from BLKB multi-line booking text.
    CR-023 fix: skip country/address lines, take FIRST meaningful line.
    """
    lines = [l.strip() for l in raw.splitlines() if l.strip()]

    if tx_type == "TWINT_MERCHANT":
        for i, line in enumerate(lines):
            if re.search(r'Ref\.?-?Nr\.?', line, re.IGNORECASE):
                if i + 1 < len(lines):
                    candidate = lines[i + 1]
                    candidate = re.sub(r',\s*[A-Z]{3,}$', '', candidate).strip()
                    return candidate.title()

    if tx_type == "TWINT_P2P":
        for i, line in enumerate(lines):
            if re.search(r'Geld (gesendet an|erhalten von)', line, re.IGNORECASE):
                if i + 1 < len(lines):
                    name = strip_noise(lines[i + 1].strip())
                    if name and len(name) > 1:
                        return name.title()
        for line in lines[1:]:
            if re.match(r'^[A-ZÄÖÜ][a-zäöü]+ [A-ZÄÖÜ][a-zäöü]+', line):
                name = strip_noise(line.strip())
                if name and len(name) > 1:
                    return name.title()

    if tx_type in ("CARD", "CARD_FOREIGN"):
        # Format: "Debitkarte Zahlung Verkaufspunkt CHF DD.MM.YYYY HH:MM MERCHANT CITY"
        # or: "Debitkarte Zahlung Ausland CHF NNN EUR NNN MERCHANT CITY .MM.YYYY ..."
        cleaned = strip_noise(raw)
        # Remove leading type tokens
        cleaned = re.sub(
            r'^(Debitkarte\s+Zahlung\s+\w+\s+|CARD[_A-Z]*\s*)',
            '', cleaned, flags=re.IGNORECASE
        ).strip()
        # Remove city repetition
        cleaned = re.sub(r'\b(\w{4,})\s+\1\b', r'\1', cleaned, flags=re.IGNORECASE)
        # Remove trailing location/number
        cleaned = re.sub(r'\s+\d+\s+[A-Z][a-z]+\s*$', '', cleaned).strip()
        if cleaned:
            return cleaned[:60].title()

    if tx_type in ("OTHER", "INCOMING", "INTERNAL_TRANSFER"):
        ref_idx = next(
            (i for i, l in enumerate(lines)
             if re.search(r'Ref\.?-?Nr\.?', l, re.IGNORECASE)),
            0
        )
        stop_keywords = re.compile(
            r'^(info|zahlbar|scor|esr|abgabe|clearing)',
            re.IGNORECASE
        )
        # First pass: look for Mitteilung content (useful for tax/insurance)
        for line in lines[ref_idx + 1:]:
            if re.match(r'^Mitteilung:', line, re.IGNORECASE):
                content = re.sub(r'^Mitteilung:\s*', '', line, flags=re.IGNORECASE).strip()
                content = strip_noise(content)
                if len(content) > 4 and not re.match(r'^\d+$', content):
                    return content.title()

        # Second pass: first meaningful non-address line
        for line in lines[ref_idx + 1:]:
            if not line or len(line) < 3:
                continue
            if _is_address_line(line):
                continue
            if stop_keywords.match(line):
                continue
            if re.match(r'^Mitteilung:', line, re.IGNORECASE):
                continue
            if re.match(r'^[\d\s\-/]+$', line):
                continue
            # Skip own name variants
            if re.search(
                r'Sch[äa]r|Sharifi|Tubhusweg|Muttenz|DePuy|Luzernstrasse'
                r'|\bManuel\b|\bFarnaz\b',
                line, re.IGNORECASE
            ):
                continue
            cleaned = strip_noise(line)
            # Remove store address numbers at end: "IKEA AG Pratteln 292 Pratteln" → "IKEA AG"
            cleaned = re.sub(r'\s+\d+\s+[A-Z][a-z]+\s*$', '', cleaned).strip()
            # Remove city repetition: "Fuengirola Fuengirola" → "Fuengirola"
            cleaned = re.sub(r'\b(\w{4,})\s+\1\b', r'\1', cleaned, flags=re.IGNORECASE)
            if len(cleaned) > 2:
                return cleaned.title()

    # Fallback: strip noise from full text
    cleaned = strip_noise(raw)
    cleaned = re.sub(
        r'(Manuel Sch[aä]r?|Farnaz Sharifi|Tubhusweg \d+|4132 Muttenz|Schweiz)',
        '', cleaned, flags=re.IGNORECASE
    )
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    if cleaned:
        return cleaned[:60].title()
    return "Unknown"


def extract_merchant_swisscard(merchant_name: str, details: str) -> str:
    """Swisscard already provides clean MerchantName."""
    name = (merchant_name or "").strip()
    detail = (details or "").strip()
    if re.search(r'\*SUBSCRIPTION|\*ANNUAL|HBR\*', detail, re.IGNORECASE):
        service = re.sub(r'[*#].*', '', detail).strip()
        if service:
            return service.title()
    return name.title() if name else "Unknown"


def extract_merchant_amazon(description: str, marketplace: str) -> str:
    """Amazon description is a full product title."""
    desc = (description or "").strip()
    if len(desc) > 80:
        desc = desc[:77] + "…"
    return desc


def extract_merchant_card(raw: str) -> str:
    """Debitkarte: merchant appears after timestamp pattern."""
    m = re.search(r'\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}\s+(.+)', raw)
    if m:
        return m.group(1).strip()[:60].title()
    return strip_noise(raw)[:60].title()


# ── API anonymisation ─────────────────────────────────────────────────────

ANONYMISE_PATTERNS = [
    r'\b(CH|DE|FR|LI)\d{2}[\s\d]{10,}',
    r'Ref\.?-?Nr\.?\s*[\d\s]+',
    r'Kartennummer\s+[\dXx\s]+',
    r'Karten-Nr\.?\s+[\dXx\s]+',
    r'\b\d{2}\.\d{2}\.\d{4}\b',
    r'\b\d{2}\.\d{2}\.\d{2}\b',
    r'\b\d{2}:\d{2}\b',
    r'[Mm]anuel\s+[Ss]ch[äa]r?',
    r'[Ff]arnaz\s+[Ss]harifi',
    r'[Tt]ubhusweg\s*\d+',
    r'4132\s*[Mm]uttenz',
]

_ANON_RE = re.compile('|'.join(ANONYMISE_PATTERNS))


def anonymize_for_api(text: str) -> str:
    """Strip sensitive data before sending to Claude API."""
    text = _ANON_RE.sub('[REDACTED]', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def extract_merchant_ubs(raw_text: str) -> str:
    """
    Extract merchant from UBS raw_text (format: Desc1 | Desc2 | Desc3).
    Desc1 is the primary merchant field.
    """
    # Take first pipe-separated segment
    desc1 = raw_text.split('|')[0].strip()
    # Take first semicolon-separated part (city comes after semicolon)
    merchant = desc1.split(';')[0].strip()
    # Strip noise
    merchant = strip_noise(merchant)
    # Remove trailing postal codes and city names
    merchant = re.sub(r'\s+\d{4,5}\s+.*$', '', merchant).strip()
    # Remove booking reference codes (6+ alphanumeric at end)
    merchant = re.sub(r'\s+[A-Z0-9]{6,}\s*$', '', merchant).strip()
    if not merchant or len(merchant) < 2:
        return "Unknown"
    return merchant.title()
