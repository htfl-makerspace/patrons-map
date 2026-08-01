"""
Steps 2.1 & 2.2 — Extract addresses and submit to Census Bulk Geocoder.

Step 2.1: Query patron_ha rows where latitude IS NULL, format for the
US Census Bulk Geocoder, split into batch CSVs of ≤10,000 rows.

Step 2.2: Submit each batch to the Census Geocoding API and save results.

Output:
  app/scripts/requests/batch_N.csv       — input batches
  app/scripts/results/result_N.csv       — geocoder results
"""

import os
import csv
import math
import random
import time
from pathlib import Path

import subprocess
from dotenv import load_dotenv
from supabase import create_client

BATCH_SIZE = 1_000  # Census API drops connection on larger batches
CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/geographies/addressbatch"
SCRIPT_DIR = Path(__file__).parent
REQUEST_DIR = SCRIPT_DIR / "requests"
RESULT_DIR = SCRIPT_DIR / "results"
ENV_PATH = SCRIPT_DIR.parent / ".env"

load_dotenv(ENV_PATH)

supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SECRET_KEY"],
)


def fetch_ungeocoded_patrons():
    """Fetch all patron_ha rows where latitude is NULL."""
    rows = []
    page_size = 1000
    offset = 0

    while True:
        resp = (
            supabase.table("patron_ha")
            .select("barcode, address, zip")
            .is_("latitude", "null")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = resp.data
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    return rows


def parse_address(full_address):
    """Extract (street_address, city) from a full address string.

    Expected format: "123 Main St, City, State ZIP" or "123 Main St, City State ZIP".
    Returns (street, city) with the street being the first comma-delimited part
    and the city being the second (if present).
    """
    if not full_address:
        return "", ""

    parts = [p.strip() for p in full_address.split(",")]

    if len(parts) >= 2:
        street = parts[0]
        # The city is the second part; strip any trailing state/zip if present
        city_part = parts[1]
        # Remove state abbreviation and zip that may be stuck to city
        # e.g. "Havertown Pa 19083" or "West Chester Pa 19380"
        tokens = city_part.split()
        # Walk backwards: remove zip (digits), then state abbrev (2-letter word)
        # Keep everything else as city name
        while tokens and tokens[-1].replace("-", "").isdigit():
            tokens.pop()
        while tokens and len(tokens[-1]) == 2 and tokens[-1].isalpha():
            tokens.pop()
        city = " ".join(tokens) if tokens else city_part
        return street, city

    # No comma — put entire string as street, leave city blank
    return full_address.strip(), ""


def write_batch_csvs(rows):
    """Split rows into Census-formatted CSVs of ≤BATCH_SIZE each."""
    REQUEST_DIR.mkdir(parents=True, exist_ok=True)

    num_batches = math.ceil(len(rows) / BATCH_SIZE)

    for i in range(num_batches):
        batch = rows[i * BATCH_SIZE : (i + 1) * BATCH_SIZE]
        out_path = REQUEST_DIR / f"batch_{i + 1}.csv"

        with open(out_path, "w", newline="") as f:
            writer = csv.writer(f)
            # No header — Census Geocoder expects raw data rows
            for row in batch:
                street, city = parse_address(row["address"])
                writer.writerow([
                    row["barcode"],       # Unique ID
                    street,               # Street address only
                    city,                 # City
                    "PA",                 # State
                    row["zip"] or "",     # ZIP
                ])

        print(f"  Wrote {out_path.name} ({len(batch)} rows)")

    return num_batches


def submit_to_census(batch_path, max_retries=3):
    """Submit a batch CSV to the Census Bulk Geocoder API via curl. Returns result path."""
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    result_path = RESULT_DIR / batch_path.name.replace("batch_", "result_")

    # Skip if result already exists
    if result_path.exists() and result_path.stat().st_size > 0:
        lines = result_path.read_text().strip().split("\n")
        matches = sum(1 for line in lines if '"Match"' in line)
        print(f"  ✓ {result_path.name} already exists ({len(lines)} rows, {matches} matched) — skipping")
        return result_path

    for attempt in range(1, max_retries + 1):
        print(f"  Submitting {batch_path.name} (attempt {attempt}/{max_retries})...")
        try:
            result = subprocess.run(
                [
                    "curl", "-s", "--max-time", "300",
                    "-F", f"addressFile=@{str(batch_path)}",
                    "-F", "benchmark=Public_AR_Current",
                    "-F", "vintage=Current_Current",
                    CENSUS_URL,
                ],
                capture_output=True, text=True, timeout=600,
            )
            if result.returncode != 0:
                raise RuntimeError(f"curl exit code {result.returncode}: {result.stderr}")
            if not result.stdout.strip():
                raise RuntimeError("Empty response from Census API")
            if "<p>" in result.stdout or "<html" in result.stdout.lower():
                raise RuntimeError("Census API returned error page (server overload or bad data)")
            break
        except (RuntimeError, subprocess.TimeoutExpired) as e:
            if attempt == max_retries:
                print(f"  FAILED after {max_retries} attempts: {e}")
                raise
            wait = 15 * attempt
            print(f"  Error: {e}. Retrying in {wait}s...")
            time.sleep(wait)

    with open(result_path, "w") as f:
        f.write(result.stdout)

    # Count matches
    lines = result.stdout.strip().split("\n")
    matches = sum(1 for line in lines if '"Match"' in line)
    print(f"  → {result_path.name}: {len(lines)} rows, {matches} matched")

    return result_path


def main():
    print("Fetching un-geocoded patrons from Supabase...")
    rows = fetch_ungeocoded_patrons()
    print(f"Found {len(rows)} rows with latitude IS NULL")

    if not rows:
        print("Nothing to geocode.")
        return

    # Step 2.1 — write batch CSVs
    num = write_batch_csvs(rows)
    print(f"\n{num} batch file(s) written to {REQUEST_DIR}/")

    # Step 2.2 — submit each batch to Census Geocoder
    print("\nSubmitting batches to Census Bulk Geocoder...")
    for i in range(1, num + 1):
        batch_path = REQUEST_DIR / f"batch_{i}.csv"
        submit_to_census(batch_path)
        if i < num:
            print("  Waiting 5s before next batch...")
            time.sleep(5)

    print("\nDone — result files written to", RESULT_DIR)


def test_sample(n=500):
    """Fetch n random ungeocoded addresses, submit to Census API, and print match stats."""
    print(f"Fetching ungeocoded patrons from Supabase...")
    rows = fetch_ungeocoded_patrons()
    print(f"Found {len(rows)} total ungeocoded rows")

    if not rows:
        print("Nothing to test.")
        return

    sample = random.sample(rows, min(n, len(rows)))
    print(f"Sampled {len(sample)} addresses for test\n")

    # Write test batch
    REQUEST_DIR.mkdir(parents=True, exist_ok=True)
    test_batch = REQUEST_DIR / "test_sample.csv"
    with open(test_batch, "w", newline="") as f:
        writer = csv.writer(f)
        for row in sample:
            street, city = parse_address(row["address"])
            writer.writerow([
                row["barcode"],
                street,
                city,
                "PA",
                row["zip"] or "",
            ])

    # Submit to Census API (bypass the skip-if-exists logic)
    print("Submitting test batch to Census API...")
    result = subprocess.run(
        [
            "curl", "-s", "--max-time", "300",
            "-F", f"addressFile=@{str(test_batch)}",
            "-F", "benchmark=Public_AR_Current",
            "-F", "vintage=Current_Current",
            CENSUS_URL,
        ],
        capture_output=True, text=True, timeout=600,
    )

    if result.returncode != 0 or not result.stdout.strip():
        print(f"ERROR: Census API failed. stderr: {result.stderr}")
        return

    # Save result
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    result_path = RESULT_DIR / "test_sample_result.csv"
    with open(result_path, "w") as f:
        f.write(result.stdout)

    # Parse and summarize results
    lines = result.stdout.strip().split("\n")
    matches = 0
    no_matches = 0
    ties = 0
    for line in lines:
        if '"Match"' in line:
            matches += 1
        elif '"No_Match"' in line:
            no_matches += 1
        elif '"Tie"' in line:
            ties += 1

    total = len(lines)
    print(f"\n{'='*40}")
    print(f"RESULTS ({total} rows)")
    print(f"{'='*40}")
    print(f"  Match:    {matches:>5}  ({100*matches/total:.1f}%)")
    print(f"  No_Match: {no_matches:>5}  ({100*no_matches/total:.1f}%)")
    if ties:
        print(f"  Tie:      {ties:>5}  ({100*ties/total:.1f}%)")
    print(f"{'='*40}")
    print(f"\nInput:  {test_batch}")
    print(f"Result: {result_path}")

    # Show a few No_Match examples
    no_match_lines = [l for l in lines if '"No_Match"' in l]
    if no_match_lines:
        print(f"\nSample No_Match rows (up to 5):")
        for line in no_match_lines[:5]:
            print(f"  {line.strip()}")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "test":
        test_sample()
    else:
        main()
