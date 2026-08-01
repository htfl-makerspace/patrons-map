"""
Step 4.1 — Export patron GeoJSON from Supabase.

Queries all geocoded patron_ha rows and writes a GeoJSON FeatureCollection
to app/public/data/patrons.geojson for use by the static SPA.
"""

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

SCRIPT_DIR = Path(__file__).parent
APP_DIR = SCRIPT_DIR.parent
OUTPUT_DIR = APP_DIR / "public" / "data"
ENV_PATH = APP_DIR / ".env"

load_dotenv(ENV_PATH)

supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SECRET_KEY"],
)

COLUMNS = "barcode, latitude, longitude, created, date_issued, p_type, zip"


def fetch_geocoded_patrons():
    """Fetch all patron_ha rows that have coordinates."""
    rows = []
    page_size = 1000
    offset = 0

    while True:
        resp = (
            supabase.table("patron_ha")
            .select(COLUMNS)
            .not_.is_("latitude", "null")
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


def build_geojson(rows):
    """Convert rows to a GeoJSON FeatureCollection."""
    features = []
    for row in rows:
        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [row["longitude"], row["latitude"]],
            },
            "properties": {
                "created": row["created"],
                "date_issued": row["date_issued"],
                "p_type": row["p_type"],
                "zip": row["zip"],
            },
        }
        features.append(feature)

    return {
        "type": "FeatureCollection",
        "features": features,
    }


def main():
    print("Fetching geocoded patrons from Supabase...")
    rows = fetch_geocoded_patrons()
    print(f"  {len(rows)} rows with coordinates")

    if not rows:
        print("No geocoded rows found.")
        sys.exit(1)

    print("Building GeoJSON...")
    geojson = build_geojson(rows)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / "patrons.geojson"

    with open(out_path, "w") as f:
        json.dump(geojson, f)

    size_mb = out_path.stat().st_size / (1024 * 1024)
    print(f"  Wrote {out_path} ({len(geojson['features'])} features, {size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
