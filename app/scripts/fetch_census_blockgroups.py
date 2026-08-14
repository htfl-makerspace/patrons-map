"""
Fetch Census block group population/income data and TIGER/Line block group
boundaries for Haverford Township tracts. Outputs:
  - app/public/data/blockgroups.json      (demographic data)
  - app/public/data/blockgroups.geojson   (boundary polygons with demographics joined)
"""

import json
import os
import sys
import tempfile
import zipfile
from pathlib import Path
from urllib.request import urlopen, Request

# Haverford Township tracts (from tracts.geojson)
STATE = "42"
COUNTY = "045"
TRACTS = [
    "400500", "400600", "401103", "401104", "401200", "407802",
    "408101", "408103", "408300", "408400", "408500", "408600",
    "408700", "408800", "408900", "409000", "409100", "409200",
    "409300", "409400", "409500", "409601", "409602", "409701",
]

DATA_DIR = Path(__file__).resolve().parent.parent / "public" / "data"

API_KEY = os.environ.get(
    "VITE_CENSUS_API_KEY",
    "975d3bc670ca5dfeb8a230e420bf3ab82eb55660",
)

ACS_BASE = "https://api.census.gov/data/2022/acs/acs5"
VARIABLES = "B01003_001E,B19013_001E,B19301_001E,B19025_001E,B11001_001E"
VARIABLE_NAMES = {
    "B01003_001E": "population",
    "B19013_001E": "median_income",
    "B19301_001E": "per_capita_income",
    "B19025_001E": "_aggregate_income",
    "B11001_001E": "_households",
}

TIGER_URL = (
    "https://www2.census.gov/geo/tiger/TIGER2022/BG/"
    f"tl_2022_{STATE}_bg.zip"
)


def fetch_census_data() -> list[dict]:
    """Fetch ACS block group data for all Haverford Township tracts."""
    records = []
    for tract in TRACTS:
        url = (
            f"{ACS_BASE}?get={VARIABLES}&for=block+group:*"
            f"&in=state:{STATE}+county:{COUNTY}+tract:{tract}"
            f"&key={API_KEY}"
        )
        print(f"  Fetching tract {tract}...")
        req = Request(url, headers={"User-Agent": "HTFL-Census-Fetch/1.0"})
        with urlopen(req) as resp:
            rows = json.loads(resp.read())

        header = rows[0]
        for row in rows[1:]:
            rec = dict(zip(header, row))
            geoid = f"{rec['state']}{rec['county']}{rec['tract']}{rec['block group']}"
            agg = _int_or_none(rec.get("B19025_001E"))
            hh = _int_or_none(rec.get("B11001_001E"))
            mean_income = round(agg / hh) if agg and hh else None

            records.append({
                "GEOID": geoid,
                "tract": rec["tract"],
                "bg": rec["block group"],
                "population": _int_or_none(rec.get("B01003_001E")),
                "mean_income": mean_income,
                "median_income": _int_or_none(rec.get("B19013_001E")),
                "per_capita_income": _int_or_none(rec.get("B19301_001E")),
            })

    return records


def _int_or_none(val):
    if val is None:
        return None
    try:
        v = int(val)
        return v if v >= 0 else None  # Census uses negative values for missing
    except (ValueError, TypeError):
        return None


def fetch_tiger_blockgroups(census_data: list[dict]) -> dict:
    """Download TIGER/Line block group shapefile, convert to GeoJSON, filter."""
    try:
        import fiona
    except ImportError:
        print("ERROR: fiona is required. Install with: pip install fiona")
        sys.exit(1)

    geoid_set = {r["GEOID"] for r in census_data}
    demo_lookup = {r["GEOID"]: r for r in census_data}

    print(f"  Downloading TIGER/Line block groups for state {STATE}...")
    req = Request(TIGER_URL, headers={"User-Agent": "HTFL-Census-Fetch/1.0"})
    with urlopen(req) as resp:
        data = resp.read()

    with tempfile.TemporaryDirectory() as tmpdir:
        zip_path = os.path.join(tmpdir, "bg.zip")
        with open(zip_path, "wb") as f:
            f.write(data)

        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(tmpdir)

        # Find the .shp file
        shp_files = list(Path(tmpdir).glob("*.shp"))
        if not shp_files:
            print("ERROR: No .shp file found in TIGER download")
            sys.exit(1)

        features = []
        with fiona.open(str(shp_files[0])) as src:
            for feat in src:
                geoid = feat["properties"].get("GEOID")
                if geoid in geoid_set:
                    # Convert fiona geometry to standard GeoJSON
                    geom = dict(feat["geometry"])
                    props = {"GEOID": geoid}
                    # Join demographic data
                    if geoid in demo_lookup:
                        props.update(demo_lookup[geoid])
                    features.append({
                        "type": "Feature",
                        "geometry": geom,
                        "properties": props,
                    })

    print(f"  Found {len(features)} block groups matching Haverford tracts")
    return {
        "type": "FeatureCollection",
        "features": features,
    }


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    print("Step 1: Fetching Census ACS data...")
    census_data = fetch_census_data()
    print(f"  Got {len(census_data)} block groups")

    # Save demographic JSON
    json_path = DATA_DIR / "blockgroups.json"
    with open(json_path, "w") as f:
        json.dump(census_data, f, indent=2)
    print(f"  Saved {json_path}")

    print("\nStep 2: Fetching TIGER/Line boundaries...")
    geojson = fetch_tiger_blockgroups(census_data)

    geojson_path = DATA_DIR / "blockgroups.geojson"
    with open(geojson_path, "w") as f:
        json.dump(geojson, f)
    print(f"  Saved {geojson_path}")

    print(f"\nDone! {len(census_data)} block groups with demographics + boundaries.")


if __name__ == "__main__":
    main()
