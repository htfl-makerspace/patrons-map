"""
Geocode patron addresses using Mapbox Geocoding v6 batch API.

Fetches patron_ha rows where latitude IS NULL, geocodes them via
Mapbox structured input in batches of 1000, uploads results back to
Supabase, and writes CSV audit trail to app/scripts/results/.

Usage:
    python3 geocode_patrons.py                              # geocode all ungeocoded rows in patron_ha_dev
    python3 geocode_patrons.py --table patron_ha            # target prod table
    python3 geocode_patrons.py test 100                     # test sample of 100 rows
    python3 geocode_patrons.py test 100 --table patron_ha   # test sample from prod
"""

import argparse
import csv
import os
import random
import re
import sys
import time
from pathlib import Path

import requests as http_requests
from dotenv import load_dotenv
from supabase import create_client

MAPBOX_BATCH_SIZE = 1000  # Mapbox batch endpoint max
MAPBOX_BATCH_URL = "https://api.mapbox.com/search/geocode/v6/batch"
SCRIPT_DIR = Path(__file__).parent
RESULT_DIR = SCRIPT_DIR / "results"
ENV_PATH = SCRIPT_DIR.parent / ".env"

load_dotenv(ENV_PATH)

MAPBOX_TOKEN = os.environ.get("MAPBOX_ACCESS_TOKEN") or os.environ["VITE_MAPBOX_API_KEY"]

supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SECRET_KEY"],
)


def fetch_ungeocoded_patrons(table):
    """Fetch all rows where latitude is NULL."""
    rows = []
    page_size = 1000
    offset = 0

    while True:
        resp = (
            supabase.table(table)
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


def fetch_low_confidence_patrons(table):
    """Fetch all rows where geocode_confidence is 'low' or latitude is NULL."""
    rows = []
    page_size = 1000
    offset = 0

    while True:
        resp = (
            supabase.table(table)
            .select("barcode, address, zip")
            .or_("latitude.is.null,geocode_confidence.eq.low")
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
    """Extract (address_number, street, city) from a full address string.

    Expected format: "123 Main St, City, State ZIP" or "123 Main St, City State ZIP".
    """
    if not full_address:
        return "", "", ""

    parts = [p.strip() for p in full_address.split(",")]
    street_part = parts[0]

    # Extract house number from street
    match = re.match(r"^(\d+[-\d]*)\s+(.+)$", street_part)
    if match:
        address_number = match.group(1)
        street = match.group(2)
    else:
        address_number = ""
        street = street_part

    city = ""
    if len(parts) >= 2:
        city_part = parts[1]
        tokens = city_part.split()
        # Remove trailing zip (digits) and state abbreviation (2-letter)
        while tokens and tokens[-1].replace("-", "").isdigit():
            tokens.pop()
        while tokens and len(tokens[-1]) == 2 and tokens[-1].isalpha():
            tokens.pop()
        city = " ".join(tokens) if tokens else city_part

    return address_number, street, city


def build_mapbox_query(row):
    """Build a Mapbox structured geocode query dict from a patron row."""
    address_number, street, city = parse_address(row["address"])
    query = {
        "types": ["address"],
        "country": "us",
        "limit": 1,
    }
    if address_number:
        query["address_number"] = address_number
    if street:
        query["street"] = street
    if city:
        query["place"] = city
    query["region"] = "PA"
    if row.get("zip"):
        query["postcode"] = str(row["zip"])
    return query


def extract_result(feature_collection):
    """Extract (lat, lng, accuracy, confidence) from a Mapbox FeatureCollection.

    Returns (None, None, None, None) if no match found.
    """
    features = feature_collection.get("features", [])
    if not features:
        return None, None, None, None

    feature = features[0]
    coords = feature.get("geometry", {}).get("coordinates", [])
    if len(coords) < 2:
        return None, None, None, None

    lng, lat = coords[0], coords[1]

    props = feature.get("properties", {})
    accuracy = props.get("coordinates", {}).get("accuracy", "")
    confidence = props.get("match_code", {}).get("confidence", "")

    return lat, lng, accuracy, confidence


DIRECTIONAL_RE = re.compile(r"^(East|West|North|South)\s+", re.IGNORECASE)


def strip_directional(street):
    """Remove leading directional prefix from a street name."""
    return DIRECTIONAL_RE.sub("", street)


def has_directional(street):
    """Check if a street name starts with a directional prefix."""
    return bool(DIRECTIONAL_RE.match(street))


def _post_batch(queries):
    """POST a batch of queries to Mapbox and return the batch results list."""
    resp = http_requests.post(
        MAPBOX_BATCH_URL,
        params={"access_token": MAPBOX_TOKEN, "permanent": "true"},
        json=queries,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("batch", [])


def geocode_batch_mapbox(rows):
    """Geocode a list of patron rows using Mapbox batch API.

    Splits into chunks of 1000, POSTs each chunk, returns list of
    (barcode, lat, lng, accuracy, confidence) tuples.

    Misses whose street name has a directional prefix (East, West, North,
    South) are retried without the directional. Only exact/high confidence
    retry results are accepted.
    """
    results = []
    total_chunks = (len(rows) + MAPBOX_BATCH_SIZE - 1) // MAPBOX_BATCH_SIZE

    for chunk_idx in range(total_chunks):
        start = chunk_idx * MAPBOX_BATCH_SIZE
        end = min(start + MAPBOX_BATCH_SIZE, len(rows))
        chunk = rows[start:end]

        queries = [build_mapbox_query(row) for row in chunk]

        batch_results = _post_batch(queries)
        matched = 0
        for i, fc in enumerate(batch_results):
            barcode = chunk[i]["barcode"]
            lat, lng, accuracy, confidence = extract_result(fc)
            results.append((barcode, lat, lng, accuracy, confidence))
            if lat is not None:
                matched += 1

        print(f"  Batch {chunk_idx + 1}/{total_chunks}: {matched}/{len(chunk)} matched")

        # Rate limit: ~20 batches/min -> 3s sleep between batches
        if chunk_idx < total_chunks - 1:
            time.sleep(3)

    # Retry misses that have a directional prefix, without the directional
    retry_indices = []
    retry_queries = []
    for i, (barcode, lat, lng, acc, conf) in enumerate(results):
        if lat is not None and conf not in ("low",):
            continue
        address_number, street, city = parse_address(rows[i]["address"])
        if not has_directional(street):
            continue
        query = build_mapbox_query(rows[i])
        query["street"] = strip_directional(street)
        retry_indices.append(i)
        retry_queries.append(query)

    if retry_queries:
        print(f"\n  Retrying {len(retry_queries)} directional addresses without prefix...")
        retry_results = _post_batch(retry_queries)
        upgraded = 0
        for j, fc in enumerate(retry_results):
            lat, lng, accuracy, confidence = extract_result(fc)
            if lat is not None and confidence in ("exact", "high"):
                idx = retry_indices[j]
                results[idx] = (results[idx][0], lat, lng, accuracy, confidence)
                upgraded += 1
        print(f"  Directional retry: {upgraded}/{len(retry_queries)} resolved (exact/high only)")

    return results


def write_results_csv(results, filename="mapbox_results.csv"):
    """Write geocoding results to CSV for audit trail."""
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = RESULT_DIR / filename

    with open(out_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["barcode", "latitude", "longitude", "accuracy", "confidence"])
        for barcode, lat, lng, accuracy, confidence in results:
            writer.writerow([barcode, lat or "", lng or "", accuracy or "", confidence or ""])

    print(f"  Results written to {out_path}")
    return out_path


def upload_to_supabase(results, table):
    """Update rows with lat/lng/accuracy/confidence from geocoding results."""
    matched = [(b, lat, lng, acc, conf) for b, lat, lng, acc, conf in results if lat is not None]
    total = len(matched)
    success = 0
    errors = 0

    for i, (barcode, lat, lng, accuracy, confidence) in enumerate(matched):
        try:
            update_data = {
                "latitude": lat,
                "longitude": lng,
                "geocode_accuracy": accuracy or None,
                "geocode_confidence": confidence or None,
            }
            supabase.table(table).update(update_data).eq("barcode", barcode).execute()
            success += 1
        except Exception as e:
            errors += 1
            if errors <= 10:
                print(f"  Error updating {barcode}: {e}")

        if (i + 1) % 500 == 0:
            print(f"  Uploaded {i + 1}/{total}")

    print(f"\nUpload complete: {success} updated, {errors} errors out of {total} matched")


def parse_args():
    """Parse CLI arguments, handling both subcommand and flag styles."""
    parser = argparse.ArgumentParser(description="Geocode patron addresses via Mapbox")
    parser.add_argument("command", nargs="?", default="run",
                        help="'run' (default) or 'test'")
    parser.add_argument("sample_size", nargs="?", type=int, default=500,
                        help="Sample size for test mode (default: 500)")
    parser.add_argument("--table", default="patron_ha_dev",
                        help="Target table (default: patron_ha_dev)")
    parser.add_argument("--retry-low", action="store_true",
                        help="Also re-geocode rows with geocode_confidence='low'")
    return parser.parse_args()


def main(table, retry_low=False):
    if retry_low:
        print(f"Fetching ungeocoded + low-confidence patrons from {table}...")
        rows = fetch_low_confidence_patrons(table)
        print(f"Found {len(rows)} rows (latitude IS NULL or confidence = low)")
    else:
        print(f"Fetching ungeocoded patrons from {table}...")
        rows = fetch_ungeocoded_patrons(table)
        print(f"Found {len(rows)} rows with latitude IS NULL")

    if not rows:
        print("Nothing to geocode.")
        return

    print(f"\nGeocoding {len(rows)} addresses via Mapbox batch API...")
    results = geocode_batch_mapbox(rows)

    # Stats
    matched = sum(1 for _, lat, *_ in results if lat is not None)
    print(f"\nMatched: {matched}/{len(results)} ({100 * matched / len(results):.1f}%)")

    # Audit trail
    write_results_csv(results)

    # Upload
    print(f"\nUploading {matched} coordinates to {table}...")
    upload_to_supabase(results, table)


def test_sample(n, table):
    """Geocode a random sample of ungeocoded addresses and print stats."""
    print(f"Fetching ungeocoded patrons from {table}...")
    rows = fetch_ungeocoded_patrons(table)
    print(f"Found {len(rows)} total ungeocoded rows")

    if not rows:
        print("Nothing to test.")
        return

    sample = random.sample(rows, min(n, len(rows)))
    print(f"Sampled {len(sample)} addresses for test\n")

    print("Geocoding via Mapbox batch API...")
    results = geocode_batch_mapbox(sample)

    # Stats
    matched = sum(1 for _, lat, *_ in results if lat is not None)
    unmatched = len(results) - matched

    # Accuracy breakdown
    accuracy_counts = {}
    confidence_counts = {}
    for _, lat, _, acc, conf in results:
        if lat is not None:
            accuracy_counts[acc] = accuracy_counts.get(acc, 0) + 1
            confidence_counts[conf] = confidence_counts.get(conf, 0) + 1

    total = len(results)
    print(f"\n{'=' * 40}")
    print(f"RESULTS ({total} rows)")
    print(f"{'=' * 40}")
    print(f"  Matched:   {matched:>5}  ({100 * matched / total:.1f}%)")
    print(f"  Unmatched: {unmatched:>5}  ({100 * unmatched / total:.1f}%)")

    if accuracy_counts:
        print(f"\n  Accuracy breakdown:")
        for acc, count in sorted(accuracy_counts.items(), key=lambda x: -x[1]):
            print(f"    {acc or 'unknown':<15} {count:>5}  ({100 * count / matched:.1f}%)")

    if confidence_counts:
        print(f"\n  Confidence breakdown:")
        for conf, count in sorted(confidence_counts.items(), key=lambda x: -x[1]):
            print(f"    {conf or 'unknown':<15} {count:>5}  ({100 * count / matched:.1f}%)")

    print(f"{'=' * 40}")

    # Write audit CSV
    write_results_csv(results, "test_sample_mapbox.csv")

    # Show unmatched examples
    unmatched_rows = [(sample[i], results[i]) for i in range(len(results)) if results[i][1] is None]
    if unmatched_rows:
        print(f"\nSample unmatched addresses (up to 5):")
        for row, _ in unmatched_rows[:5]:
            print(f"  {row['barcode']}: {row['address']}, {row['zip']}")


if __name__ == "__main__":
    args = parse_args()
    if args.command == "test":
        test_sample(args.sample_size, args.table)
    else:
        main(args.table, retry_low=args.retry_low)
