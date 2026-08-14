"""
Preprocess unmatched/low-confidence addresses before sending to Google validation.

Reads the unmatched CSV, filters out addresses that are definitely unresolvable
(empty, number-only, PO boxes, etc.), cleans salvageable addresses by stripping
junk prefixes and noise, and outputs a CSV ready for validate_addresses.py.

Usage:
    python3 preprocess_unmatched.py                                    # default input/output
    python3 preprocess_unmatched.py --input results/unmatched_remaining.csv
    python3 preprocess_unmatched.py --output results/unmatched_for_google.csv
"""

import argparse
import csv
import re
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
RESULT_DIR = SCRIPT_DIR / "results"
DEFAULT_INPUT = RESULT_DIR / "unmatched_remaining.csv"
DEFAULT_OUTPUT = RESULT_DIR / "unmatched_for_google.csv"
DISCARD_OUTPUT = RESULT_DIR / "unmatched_discarded.csv"


def classify_address(address, zip_code):
    """Classify an address as 'resolvable', or a discard reason string.

    Returns:
        ('resolvable', cleaned_address) or ('reason', original_address)
    """
    if not address or not address.strip():
        return "empty", address or ""

    addr = address.strip()

    # --- Strip known junk prefixes ---
    addr = clean_prefix(addr)

    # --- Check for PO Box ---
    if re.match(r'^P\.?O\.?\s*Box\b', addr, re.IGNORECASE):
        return "po_box", address

    # --- Parse into street part and rest ---
    parts = [p.strip() for p in addr.split(",")]
    street_part = parts[0]

    # --- Number-only: just a house number, no street name ---
    # e.g. "1000", "300", "19" — after splitting on comma, the street part is just digits
    if re.match(r'^\d+$', street_part):
        return "number_only", address

    # --- No house number: starts with a letter (street name only) ---
    # e.g. "Carter Rd", "Glendale Rd I-41", "Harvest And Taylor Ln"
    # But allow "One Downs Circle" (written-out number)
    if not re.match(r'^\d', street_part) and not re.match(r'^(One|Two|Three|Four|Five)\b', street_part, re.IGNORECASE):
        return "no_house_number", address

    # --- Incomplete directional: house number + bare directional, no street ---
    # e.g. "115 E.", "115 E" — just a number and a cardinal direction
    if re.match(r'^\d+\s+[NESW]\.?$', street_part, re.IGNORECASE):
        return "incomplete_directional", address

    # --- Looks resolvable ---
    # Rebuild the full address with cleaned street part
    parts[0] = street_part
    cleaned = ", ".join(parts)

    return "resolvable", cleaned


def clean_prefix(addr):
    """Strip junk prefixes that appear before a real address."""
    # *Mail Returned* ...
    addr = re.sub(r'^\*Mail Returned\*\s*', '', addr, flags=re.IGNORECASE)

    # Mail Ret'D 4/3/26 ... (date varies)
    addr = re.sub(r"^Mail Ret'?[Dd]\s*\d{1,2}/\d{1,2}/\d{2,4}\s*", '', addr, flags=re.IGNORECASE)

    # Ah@Ud or similar short junk tokens before an address
    # Match any non-space token containing @ or other non-alpha noise, followed by a space and digits
    addr = re.sub(r'^[A-Za-z]*@[A-Za-z]*\s+', '', addr)

    # Building/complex name prefix: "219 Radnor House, 1030 E Lancaster Ave, ..."
    # or "Wallingford Apartments I-2, 1925 Lawrence Road, ..."
    # Heuristic: if first comma-part doesn't start with a digit but second does,
    # the real address is the second part onward
    parts = [p.strip() for p in addr.split(",")]
    if len(parts) >= 3:
        first = parts[0]
        second = parts[1]
        # Check if first part looks like a building name (contains words like House, Apartments)
        # or is a unit designation like "35 Hannum Drive" paired with "370 Lancaster Ave"
        building_keywords = r'\b(house|apartments?|building|complex|suite|unit)\b'
        if re.search(building_keywords, first, re.IGNORECASE) and re.match(r'^\d', second):
            addr = ", ".join(parts[1:])

    return addr.strip()


def main():
    parser = argparse.ArgumentParser(description="Preprocess unmatched addresses for Google validation")
    parser.add_argument("--input", default=str(DEFAULT_INPUT),
                        help=f"Input CSV (default: {DEFAULT_INPUT.relative_to(SCRIPT_DIR)})")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT),
                        help=f"Output CSV for Google (default: {DEFAULT_OUTPUT.relative_to(SCRIPT_DIR)})")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        print(f"ERROR: Input file not found: {input_path}")
        raise SystemExit(1)

    # Read input
    rows = []
    with open(input_path, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)

    print(f"Read {len(rows)} rows from {input_path.name}\n")

    # Classify each row
    resolvable = []
    discarded = []
    reason_counts = {}

    for row in rows:
        address = row.get("address", "")
        zip_code = row.get("zip", "")
        reason, cleaned = classify_address(address, zip_code)

        if reason == "resolvable":
            resolvable.append({
                "barcode": row["barcode"],
                "address": cleaned,
                "zip": zip_code,
                "original_address": address,
            })
        else:
            discarded.append({
                "barcode": row["barcode"],
                "address": address,
                "zip": zip_code,
                "reason": reason,
            })
            reason_counts[reason] = reason_counts.get(reason, 0) + 1

    # Summary
    print(f"{'=' * 50}")
    print(f"PREPROCESSING RESULTS ({len(rows)} rows)")
    print(f"{'=' * 50}")
    print(f"  Resolvable:   {len(resolvable):>5}  (sending to Google)")
    print(f"  Discarded:    {len(discarded):>5}  (unresolvable)")
    print()
    print(f"  Discard breakdown:")
    for reason, count in sorted(reason_counts.items(), key=lambda x: -x[1]):
        print(f"    {reason:<25} {count:>5}")
    print(f"{'=' * 50}")

    # Show cleaned addresses that changed
    changed = [r for r in resolvable if r["address"] != r["original_address"]]
    if changed:
        print(f"\nCleaned prefixes ({len(changed)} addresses):")
        for r in changed[:15]:
            print(f"  {r['barcode']}:")
            print(f"    BEFORE: {r['original_address']}")
            print(f"    AFTER:  {r['address']}")

    # Write resolvable CSV (same schema as Supabase query: barcode, address, zip)
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["barcode", "address", "zip"])
        for r in resolvable:
            writer.writerow([r["barcode"], r["address"], r["zip"]])
    print(f"\nResolvable CSV written to {output_path}")

    # Write discarded CSV
    with open(DISCARD_OUTPUT, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["barcode", "address", "zip", "reason"])
        for r in discarded:
            writer.writerow([r["barcode"], r["address"], r["zip"], r["reason"]])
    print(f"Discarded CSV written to {DISCARD_OUTPUT}")

    print(f"\nNext step: python3 validate_addresses.py --csv {output_path.relative_to(SCRIPT_DIR)}")


if __name__ == "__main__":
    main()
