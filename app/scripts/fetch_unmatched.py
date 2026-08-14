"""
Fetch unmatched/low-confidence rows from Supabase and write to CSV.

By default fetches rows where latitude IS NULL. With --include-low,
also includes rows with geocode_confidence = 'low'.
Writes results to results/unmatched_remaining.csv.

Usage:
    python3 fetch_unmatched.py                       # NULL coords from patron_ha_dev
    python3 fetch_unmatched.py --include-low         # also include low-confidence rows
    python3 fetch_unmatched.py --table patron_ha     # from prod table
"""

import argparse
import csv
import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

SCRIPT_DIR = Path(__file__).parent
RESULT_DIR = SCRIPT_DIR / "results"
ENV_PATH = SCRIPT_DIR.parent / ".env"
OUTPUT_PATH = RESULT_DIR / "unmatched_remaining.csv"

load_dotenv(ENV_PATH)

supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SECRET_KEY"],
)


def fetch_unmatched(table, include_low=False):
    """Fetch unmatched rows from Supabase.

    By default fetches only rows where latitude IS NULL.
    If include_low is True, also includes rows with geocode_confidence = 'low'.
    """
    rows = []
    page_size = 1000
    offset = 0

    while True:
        query = supabase.table(table).select("barcode, address, zip, geocode_confidence")
        if include_low:
            query = query.or_("latitude.is.null,geocode_confidence.eq.low")
        else:
            query = query.is_("latitude", "null")
        resp = query.range(offset, offset + page_size - 1).execute()
        batch = resp.data
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    return rows


def main():
    parser = argparse.ArgumentParser(description="Fetch unmatched rows from Supabase")
    parser.add_argument("--table", default="patron_ha_dev",
                        help="Source table (default: patron_ha_dev)")
    parser.add_argument("--include-low", action="store_true",
                        help="Also include rows with geocode_confidence = 'low'")
    args = parser.parse_args()

    label = "latitude IS NULL or confidence = low" if args.include_low else "latitude IS NULL"
    print(f"Fetching unmatched rows from {args.table}...")
    rows = fetch_unmatched(args.table, include_low=args.include_low)
    print(f"  Found {len(rows)} rows ({label})")

    if not rows:
        print("Nothing to write.")
        return

    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["barcode", "address", "zip", "geocode_confidence"])
        for row in rows:
            writer.writerow([
                row["barcode"],
                row.get("address") or "",
                row.get("zip") or "",
                row.get("geocode_confidence") or "",
            ])

    print(f"  Written to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
