"""
Validate and correct patron addresses using the Google Address Validation API.

Fetches rows from Supabase where geocoding failed (latitude IS NULL or
geocode_confidence = 'low'), sends each address to Google for validation,
updates corrected addresses in Supabase, and strips coordinates on corrected
rows so they get re-geocoded on the next geocode_patrons.py run.

Requires GOOGLE_ADDRESS_VALIDATION_KEY in app/.env.
Enable the Address Validation API in your Google Cloud project.

Usage:
    python3 validate_addresses.py                          # validate failures in patron_ha_dev
    python3 validate_addresses.py --table patron_ha        # target prod table
    python3 validate_addresses.py --dry-run                # preview corrections without updating Supabase
    python3 validate_addresses.py --csv results/unmatched_for_google.csv  # use preprocessed CSV
"""

import argparse
import csv
import os
import re
import sys
import time
from pathlib import Path

import requests as http_requests
from dotenv import load_dotenv
from supabase import create_client

SCRIPT_DIR = Path(__file__).parent
RESULT_DIR = SCRIPT_DIR / "results"
ENV_PATH = SCRIPT_DIR.parent / ".env"

load_dotenv(ENV_PATH)

GOOGLE_API_KEY = os.environ.get("VITE_GOOGLE_ADDRESS_VALIDATION_KEY", "")
GOOGLE_VALIDATE_URL = "https://addressvalidation.googleapis.com/v1:validateAddress"

supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SECRET_KEY"],
)


def read_csv_input(csv_path):
    """Read addresses from a preprocessed CSV (barcode, address, zip)."""
    rows = []
    with open(csv_path, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append({
                "barcode": int(row["barcode"]),
                "address": row.get("address", ""),
                "zip": row.get("zip", ""),
            })
    return rows


def fetch_failed_rows(table):
    """Fetch rows where latitude IS NULL or geocode_confidence = 'low'."""
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


def parse_address_parts(full_address):
    """Parse 'street, city, state zip' into (street, city, state).

    Expected formats:
        '123 Main St, Havertown, Pa 19083'
        '123 Main St, Havertown Pa 19083'
        '*Mail Returned* 123 Main St, Havertown, Pa 19083'
    """
    if not full_address:
        return "", "", ""

    # Strip *Mail Returned* prefix
    addr = re.sub(r'^\*Mail Returned\*\s*', '', full_address, flags=re.IGNORECASE)

    parts = [p.strip() for p in addr.split(",")]
    street = parts[0]

    city = ""
    state = ""
    if len(parts) >= 2:
        tokens = parts[-1].split() if len(parts) >= 2 else []
        if len(parts) >= 3:
            city = parts[1].strip()
            tokens = parts[2].split()

        # Remove trailing zip digits
        while tokens and tokens[-1].replace("-", "").isdigit():
            tokens.pop()
        # Last token should be state abbreviation
        if tokens and len(tokens[-1]) == 2 and tokens[-1].isalpha():
            state = tokens.pop().upper()
        city = city or " ".join(tokens)

    return street, city, state


def validate_address_google(street, city, state, zip_code):
    """Call Google Address Validation API.

    Returns dict with keys: street, city, state, zip, status, formatted_address.
    Status is 'corrected', 'confirmed', 'not_found', or 'error:...'.
    """
    if not GOOGLE_API_KEY:
        print("ERROR: GOOGLE_ADDRESS_VALIDATION_KEY must be set in app/.env")
        print("Enable the Address Validation API in your Google Cloud project.")
        raise SystemExit(1)

    body = {
        "address": {
            "regionCode": "US",
            "addressLines": [street],
            "locality": city,
            "administrativeArea": state or "PA",
            "postalCode": str(zip_code).split("-")[0][:5] if zip_code else "",
        },
        "enableUspsCass": True,
    }

    try:
        resp = http_requests.post(
            GOOGLE_VALIDATE_URL,
            params={"key": GOOGLE_API_KEY},
            json=body,
            timeout=10,
        )

        if resp.status_code == 429:
            time.sleep(2)
            return validate_address_google(street, city, state, zip_code)

        resp.raise_for_status()
        data = resp.json()

        result = data.get("result", {})
        verdict = result.get("verdict", {})
        address = result.get("address", {})

        # Extract corrected components from addressComponents
        components = address.get("addressComponents", [])
        comp_map = {}
        for comp in components:
            ctype = comp.get("componentType", "")
            # Use the confirmed or inferred name; fall back to original
            name = comp.get("componentName", {}).get("text", "")
            comp_map[ctype] = name

        google_street = _build_street_from_components(comp_map)
        google_city = comp_map.get("locality", "")
        google_state = comp_map.get("administrative_area_level_1", "")
        google_zip = comp_map.get("postal_code", "")

        # Use formatted address as fallback
        formatted = address.get("formattedAddress", "")

        # Determine status from verdict
        address_complete = verdict.get("addressComplete", False)
        has_unconfirmed = verdict.get("hasUnconfirmedComponents", False)
        has_inferred = verdict.get("hasInferredComponents", False)

        if not address_complete and not google_street:
            return {
                "street": None, "city": None, "state": None, "zip": None,
                "formatted": formatted, "status": "not_found",
            }

        # Check if address was changed
        input_norm = street.upper().strip()
        google_norm = google_street.upper().strip()
        if input_norm == google_norm:
            status = "confirmed"
        else:
            status = "corrected"

        return {
            "street": google_street,
            "city": google_city,
            "state": google_state,
            "zip": google_zip,
            "formatted": formatted,
            "status": status,
        }

    except http_requests.exceptions.HTTPError as e:
        return {
            "street": None, "city": None, "state": None, "zip": None,
            "formatted": None, "status": f"error:{e}",
        }
    except Exception as e:
        return {
            "street": None, "city": None, "state": None, "zip": None,
            "formatted": None, "status": f"error:{e}",
        }


def _build_street_from_components(comp_map):
    """Build a street address line from Google address components."""
    parts = []
    # Street number
    if comp_map.get("street_number"):
        parts.append(comp_map["street_number"])
    # Route (street name)
    if comp_map.get("route"):
        parts.append(comp_map["route"])
    return " ".join(parts)


def rebuild_address(street, city, state, zip_code):
    """Rebuild address string in project format: 'street, city, state zip'."""
    street_tc = street.title() if street else ""
    city_tc = city.title() if city else ""
    state_tc = state.title() if state else ""
    parts = [street_tc]
    if city_tc:
        parts.append(city_tc)
    suffix = ""
    if state_tc:
        suffix = state_tc
    if zip_code:
        suffix = f"{suffix} {zip_code}" if suffix else zip_code
    if suffix:
        parts.append(suffix)
    return ", ".join(parts)


def write_audit_csv(results, filename="google_validation.csv"):
    """Write validation results to CSV."""
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = RESULT_DIR / filename

    with open(out_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "barcode", "original_address", "original_zip",
            "google_street", "google_city", "google_state", "google_zip",
            "google_formatted", "corrected_address", "status",
        ])
        for row in results:
            writer.writerow([
                row["barcode"], row["original_address"], row["original_zip"],
                row["google_street"] or "", row["google_city"] or "",
                row["google_state"] or "", row["google_zip"] or "",
                row["google_formatted"] or "",
                row["corrected_address"] or "", row["status"],
            ])

    print(f"  Audit CSV written to {out_path}")
    return out_path


def update_supabase(results, table):
    """Update corrected addresses in Supabase and strip their coordinates."""
    corrected = [r for r in results if r["status"] == "corrected" and r["corrected_address"]]
    if not corrected:
        print("  No corrections to apply.")
        return

    success = 0
    errors = 0
    for r in corrected:
        try:
            supabase.table(table).update({
                "address": r["corrected_address"],
                "zip": r["google_zip"] or r["original_zip"],
                "latitude": None,
                "longitude": None,
                "geocode_accuracy": None,
                "geocode_confidence": None,
            }).eq("barcode", r["barcode"]).execute()
            success += 1
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"  Error updating {r['barcode']}: {e}")

        if (success + errors) % 100 == 0:
            print(f"  Updated {success + errors}/{len(corrected)}")

    print(f"\n  Update complete: {success} corrected, {errors} errors")


def main():
    parser = argparse.ArgumentParser(description="Validate addresses via Google Address Validation API")
    parser.add_argument("--table", default="patron_ha_dev",
                        help="Target table (default: patron_ha_dev)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview corrections without updating Supabase")
    parser.add_argument("--csv", type=str, default=None,
                        help="Read addresses from CSV instead of querying Supabase")
    args = parser.parse_args()

    if not GOOGLE_API_KEY:
        print("ERROR: GOOGLE_ADDRESS_VALIDATION_KEY must be set in app/.env")
        print("Enable the Address Validation API in your Google Cloud project.")
        raise SystemExit(1)

    # 1. Fetch failed rows (from CSV or Supabase)
    if args.csv:
        print(f"Reading addresses from {args.csv}...")
        rows = read_csv_input(args.csv)
        print(f"  Loaded {len(rows)} rows from CSV\n")
    else:
        print(f"Fetching failed rows from {args.table}...")
        rows = fetch_failed_rows(args.table)
        print(f"  Found {len(rows)} rows (latitude IS NULL or confidence = low)\n")

    if not rows:
        print("Nothing to validate.")
        return

    # 2. Validate each address
    print(f"Validating {len(rows)} addresses with Google Address Validation API...")
    results = []
    corrected_count = 0
    confirmed_count = 0
    not_found_count = 0
    error_count = 0
    skipped_count = 0

    for i, row in enumerate(rows):
        barcode = row["barcode"]
        address = row.get("address") or ""
        zip_code = row.get("zip") or ""

        # Skip empty addresses
        if not address.strip():
            results.append({
                "barcode": barcode,
                "original_address": address,
                "original_zip": zip_code,
                "google_street": None, "google_city": None,
                "google_state": None, "google_zip": None,
                "google_formatted": None,
                "corrected_address": None,
                "status": "skipped_empty",
            })
            skipped_count += 1
            continue

        street, city, state = parse_address_parts(address)

        g = validate_address_google(street, city, state or "PA", zip_code)

        corrected_address = None
        if g["status"] in ("corrected", "confirmed") and g["street"]:
            corrected_address = rebuild_address(
                g["street"], g["city"] or city,
                g["state"] or state or "Pa", g["zip"] or zip_code
            )

        if g["status"] == "corrected":
            corrected_count += 1
        elif g["status"] == "confirmed":
            confirmed_count += 1
        elif g["status"] == "not_found":
            not_found_count += 1
        else:
            error_count += 1

        results.append({
            "barcode": barcode,
            "original_address": address,
            "original_zip": zip_code,
            "google_street": g["street"],
            "google_city": g["city"],
            "google_state": g["state"],
            "google_zip": g["zip"],
            "google_formatted": g["formatted"],
            "corrected_address": corrected_address,
            "status": g["status"],
        })

        if (i + 1) % 50 == 0:
            print(f"  Processed {i + 1}/{len(rows)}")

        # Be conservative with rate limiting
        time.sleep(0.05)

    # 3. Summary
    total = len(results)
    print(f"\n{'=' * 50}")
    print(f"GOOGLE VALIDATION RESULTS ({total} rows)")
    print(f"{'=' * 50}")
    print(f"  Corrected:    {corrected_count:>5}  (address changed by Google)")
    print(f"  Confirmed:    {confirmed_count:>5}  (address OK as-is)")
    print(f"  Not found:    {not_found_count:>5}  (Google can't resolve)")
    print(f"  Skipped:      {skipped_count:>5}  (empty address)")
    print(f"  Errors:       {error_count:>5}")
    print(f"{'=' * 50}")

    # Show sample corrections
    corrections = [r for r in results if r["status"] == "corrected"]
    if corrections:
        print(f"\nSample corrections (up to 10):")
        for r in corrections[:10]:
            print(f"  {r['barcode']}:")
            print(f"    BEFORE: {r['original_address']}")
            print(f"    AFTER:  {r['corrected_address']}")

    # 4. Write audit CSV
    print()
    write_audit_csv(results)

    # 5. Update Supabase (unless dry-run)
    if args.dry_run:
        print(f"\n  --dry-run: skipping Supabase update ({corrected_count} corrections not applied)")
        print("  Re-run without --dry-run to apply corrections and trigger re-geocoding.")
    else:
        print(f"\nUpdating {corrected_count} corrected addresses in {args.table}...")
        update_supabase(results, args.table)
        print(f"\nDone. Run geocode_patrons.py to re-geocode the corrected addresses.")


if __name__ == "__main__":
    main()
