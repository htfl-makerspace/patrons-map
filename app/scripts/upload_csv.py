"""
Upload cleaned patron CSV to Supabase.

Upserts rows: existing barcodes get columns updated, new barcodes get inserted.
Supports --table flag to target patron_ha (prod) or patron_ha_dev (dev).

Usage:
    python3 upload_csv.py                          # upsert to patron_ha_dev
    python3 upload_csv.py --table patron_ha        # upsert to patron_ha (prod)
    python3 upload_csv.py --strip-coords           # clear lat/lng on all rows
    python3 upload_csv.py --strip-coords --table patron_ha
"""

import argparse
import csv
import math
import os
import sys
from pathlib import Path

sys.stdout.reconfigure(line_buffering=True)

from dotenv import load_dotenv
from supabase import create_client

SCRIPT_DIR = Path(__file__).parent
ENV_PATH = SCRIPT_DIR.parent / ".env"
CSV_PATH = SCRIPT_DIR.parent.parent / "jupyter" / "data" / "cleaned_csv" / "patron_ha_cleaned.csv"

load_dotenv(ENV_PATH)

supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SECRET_KEY"],
)

# Column mapping: CSV header -> Supabase column
CSV_TO_DB = {
    "barcode":      "barcode",
    "address":      "address",
    "zip":          "zip",
    "birth_date":   "birth_date",
    "date_issued":  "date_issued",
    "circ_active":  "circ_active",
    "created":      "created",
    "p_type":       "p_type",
    "pat_agency":   "pat_agency",
    "issuing_lib":  "issuing_lib",
    "card_at":      "card_at",
    "cur_chkout":   "cur_chkout",
    "tot_chkout":   "tot_chkout",
}

INT_COLS = {"barcode", "p_type", "pat_agency", "card_at", "cur_chkout", "tot_chkout"}
DATE_COLS = {"birth_date", "date_issued", "circ_active", "created"}


def parse_row(row):
    """Convert a CSV row dict to a Supabase-ready dict."""
    record = {}
    for csv_col, db_col in CSV_TO_DB.items():
        val = row.get(csv_col, "").strip()
        if not val:
            record[db_col] = None
        elif db_col in INT_COLS:
            record[db_col] = int(val)
        elif db_col in DATE_COLS:
            record[db_col] = val  # ISO format string, Supabase handles it
        else:
            record[db_col] = val
    return record


def read_csv():
    """Read the cleaned CSV and return list of Supabase-ready dicts."""
    if not CSV_PATH.exists():
        print(f"ERROR: CSV not found at {CSV_PATH}")
        raise SystemExit(1)

    records = []
    with open(CSV_PATH, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            records.append(parse_row(row))

    print(f"Read {len(records)} rows from {CSV_PATH.name}")
    return records


def upsert_to_supabase(records, table):
    """Batch upsert records to the target table."""
    batch_size = 500
    total = len(records)
    success = 0
    errors = 0

    for i in range(0, total, batch_size):
        batch = records[i : i + batch_size]
        try:
            supabase.table(table).upsert(batch, on_conflict="barcode").execute()
            success += len(batch)
        except Exception as e:
            errors += len(batch)
            print(f"  Error on batch {i // batch_size + 1}: {e}")

        done = min(i + batch_size, total)
        if done % 2000 == 0 or done == total:
            print(f"  Upserted {done}/{total}")

    print(f"\nUpsert complete: {success} succeeded, {errors} failed out of {total}")


def strip_coordinates(table):
    """Set latitude, longitude, geocode_accuracy, geocode_confidence to NULL on all rows."""
    print(f"Stripping coordinates from all rows in {table}...")

    # Fetch all barcodes
    barcodes = []
    page_size = 1000
    offset = 0
    while True:
        resp = (
            supabase.table(table)
            .select("barcode")
            .not_.is_("latitude", "null")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = resp.data
        if not batch:
            break
        barcodes.extend(r["barcode"] for r in batch)
        if len(batch) < page_size:
            break
        offset += page_size

    if not barcodes:
        print("  No rows with coordinates found.")
        return

    print(f"  Found {len(barcodes)} rows with coordinates")

    cleared = 0
    errors = 0
    for i, barcode in enumerate(barcodes):
        try:
            supabase.table(table).update({
                "latitude": None,
                "longitude": None,
                "geocode_accuracy": None,
                "geocode_confidence": None,
            }).eq("barcode", barcode).execute()
            cleared += 1
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"  Error clearing {barcode}: {e}")

        if (i + 1) % 1000 == 0:
            print(f"  Cleared {i + 1}/{len(barcodes)}")

    print(f"\nStrip complete: {cleared} cleared, {errors} errors")


def verify(table):
    """Print row count and coordinate stats."""
    total_resp = supabase.table(table).select("barcode", count="exact").execute()
    geocoded_resp = (
        supabase.table(table)
        .select("barcode", count="exact")
        .not_.is_("latitude", "null")
        .execute()
    )
    total = total_resp.count
    geocoded = geocoded_resp.count
    pct = (100 * geocoded / total) if total else 0
    print(f"\n{table}: {total} total rows, {geocoded} geocoded ({pct:.1f}%)")


def main():
    parser = argparse.ArgumentParser(description="Upload cleaned CSV to Supabase")
    parser.add_argument("--table", default="patron_ha_dev",
                        help="Target table (default: patron_ha_dev)")
    parser.add_argument("--strip-coords", action="store_true",
                        help="Clear all coordinates instead of uploading CSV")
    parser.add_argument("--csv", type=str, default=None,
                        help="Path to CSV file (default: jupyter/data/cleaned_csv/patron_ha_cleaned.csv)")
    args = parser.parse_args()

    global CSV_PATH
    if args.csv:
        CSV_PATH = Path(args.csv)

    if args.strip_coords:
        strip_coordinates(args.table)
    else:
        records = read_csv()
        print(f"\nUpserting {len(records)} rows to {args.table}...")
        upsert_to_supabase(records, args.table)

    verify(args.table)


if __name__ == "__main__":
    main()
