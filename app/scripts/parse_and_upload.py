"""
Step 2.3 — Parse geocoder results and update Supabase with lat/lng.

Reads all result CSVs from app/scripts/results/, filters for matches,
extracts lon/lat, and batch-updates patron_ha in Supabase.
"""

import os
import sys
import csv
from pathlib import Path

# Unbuffered output for background execution
sys.stdout.reconfigure(line_buffering=True)

from dotenv import load_dotenv
from supabase import create_client

SCRIPT_DIR = Path(__file__).parent
RESULT_DIR = SCRIPT_DIR / "results"
ENV_PATH = SCRIPT_DIR.parent / ".env"

load_dotenv(ENV_PATH)

supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SECRET_KEY"],
)

# Census result columns (no header row):
# 0: id, 1: input_address, 2: match_status, 3: match_type,
# 4: matched_address, 5: lon_lat, 6: tiger_id, 7: side,
# 8: state_fips, 9: county_fips, 10: tract, 11: block
MATCH_STATUS_COL = 2
MATCH_TYPE_COL = 3
LON_LAT_COL = 5
ID_COL = 0


def parse_results():
    """Parse all result CSVs and return list of (barcode, lat, lng) tuples."""
    updates = []
    total = 0
    matched = 0
    exact = 0
    non_exact = 0
    no_match = 0
    ties = 0

    result_files = sorted(RESULT_DIR.glob("result_*.csv"))
    if not result_files:
        print("No result files found in", RESULT_DIR)
        return updates

    for result_file in result_files:
        with open(result_file, "r") as f:
            reader = csv.reader(f)
            for row in reader:
                total += 1
                if len(row) < 6:
                    no_match += 1
                    continue

                status = row[MATCH_STATUS_COL].strip()
                if status == "Match":
                    matched += 1
                    match_type = row[MATCH_TYPE_COL].strip()
                    if match_type == "Exact":
                        exact += 1
                    else:
                        non_exact += 1

                    lon_lat = row[LON_LAT_COL].strip()
                    barcode = row[ID_COL].strip()

                    try:
                        lon_str, lat_str = lon_lat.split(",")
                        lng = float(lon_str)
                        lat = float(lat_str)
                        updates.append((barcode, lat, lng))
                    except (ValueError, IndexError) as e:
                        print(f"  Warning: bad lon_lat '{lon_lat}' for {barcode}: {e}")
                elif status == "No_Match":
                    no_match += 1
                elif status == "Tie":
                    ties += 1

    print(f"\nParsed {total} rows across {len(result_files)} files:")
    print(f"  Match:      {matched:>6}  ({100*matched/total:.1f}%)")
    print(f"    Exact:    {exact:>6}  ({100*exact/total:.1f}%)")
    print(f"    Non_Exact:{non_exact:>6}  ({100*non_exact/total:.1f}%)")
    print(f"  No_Match:   {no_match:>6}  ({100*no_match/total:.1f}%)")
    print(f"  Tie:        {ties:>6}  ({100*ties/total:.1f}%)")
    print(f"\n  Updates to apply: {len(updates)}")

    return updates


def upload_to_supabase(updates, batch_size=500):
    """Batch update patron_ha rows with lat/lng."""
    total = len(updates)
    success = 0
    errors = 0

    for i in range(0, total, batch_size):
        batch = updates[i : i + batch_size]
        batch_num = i // batch_size + 1
        total_batches = (total + batch_size - 1) // batch_size

        for barcode, lat, lng in batch:
            try:
                supabase.table("patron_ha").update(
                    {"latitude": lat, "longitude": lng}
                ).eq("barcode", barcode).execute()
                success += 1
            except Exception as e:
                errors += 1
                if errors <= 10:
                    print(f"  Error updating {barcode}: {e}")

        print(f"  Batch {batch_num}/{total_batches} done ({min(i + batch_size, total)}/{total})")

    print(f"\nUpload complete: {success} updated, {errors} errors")


def verify():
    """Check how many patron_ha rows now have coordinates."""
    has_coords = (
        supabase.table("patron_ha")
        .select("barcode", count="exact")
        .not_.is_("latitude", "null")
        .execute()
    )
    total = (
        supabase.table("patron_ha")
        .select("barcode", count="exact")
        .execute()
    )
    geocoded = has_coords.count
    all_rows = total.count
    print(f"\nVerification: {geocoded}/{all_rows} patron_ha rows have coordinates ({100*geocoded/all_rows:.1f}%)")


def main():
    print("Step 2.3 — Parse geocoder results and update Supabase\n")

    updates = parse_results()
    if not updates:
        print("No updates to apply.")
        return

    print(f"\nUploading {len(updates)} coordinates to Supabase...")
    upload_to_supabase(updates)

    print("\nVerifying...")
    try:
        verify()
    except Exception as e:
        print(f"  Verification query failed: {e}")
        print("  Run manually: SELECT COUNT(*) FROM patron_ha WHERE latitude IS NOT NULL;")


if __name__ == "__main__":
    main()
