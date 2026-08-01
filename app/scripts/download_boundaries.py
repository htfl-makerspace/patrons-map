"""
Steps 4.2 & 4.3 — Download county and township boundary GeoJSON files.

Uses the US Census TIGERweb REST API to fetch cartographic boundary data
as GeoJSON directly (no shapefile conversion needed).

Counties: Delaware (42045), Chester (42029), Montgomery (42091), Philadelphia (42101)
Townships: County subdivisions (cousub) for the same counties.
"""

import json
import urllib.request
from pathlib import Path

APP_DIR = Path(__file__).parent.parent
OUTPUT_DIR = APP_DIR / "public" / "data"

# FIPS codes: PA = 42
STATE_FIPS = "42"
COUNTY_FIPS = ["045", "029", "091", "101"]  # Delaware, Chester, Montgomery, Philadelphia

# TIGERweb REST API base (cartographic boundaries)
TIGER_BASE = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2023/MapServer"

# Layer IDs (from TIGERweb MapServer):
#   82 = Counties
#   84 = County Subdivisions (townships/boroughs)
COUNTY_LAYER = 82
COUSUB_LAYER = 84


def fetch_tiger_geojson(layer_id, where_clause):
    """Query a TIGERweb layer and return GeoJSON features."""
    params = (
        f"where={urllib.parse.quote(where_clause)}"
        f"&outFields=*"
        f"&returnGeometry=true"
        f"&f=geojson"
        f"&outSR=4326"
    )
    url = f"{TIGER_BASE}/{layer_id}/query?{params}"

    print(f"  Fetching: {url[:120]}...")
    req = urllib.request.Request(url, headers={"User-Agent": "HTFL-PatronMap/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())

    if "features" not in data:
        raise RuntimeError(f"Unexpected response: {json.dumps(data)[:200]}")

    return data


def download_counties():
    """Step 4.2 — Download county boundaries."""
    county_list = ",".join(f"'{STATE_FIPS}{c}'" for c in COUNTY_FIPS)
    where = f"GEOID IN ({county_list})"
    geojson = fetch_tiger_geojson(COUNTY_LAYER, where)
    print(f"  Got {len(geojson['features'])} county features")
    return geojson


def download_townships():
    """Step 4.3 — Download township/cousub boundaries."""
    county_list = ",".join(f"'{c}'" for c in COUNTY_FIPS)
    where = f"STATE='{STATE_FIPS}' AND COUNTY IN ({county_list})"
    geojson = fetch_tiger_geojson(COUSUB_LAYER, where)
    print(f"  Got {len(geojson['features'])} township features")
    return geojson


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Step 4.2
    print("Downloading county boundaries...")
    counties = download_counties()
    counties_path = OUTPUT_DIR / "counties.geojson"
    with open(counties_path, "w") as f:
        json.dump(counties, f)
    size_kb = counties_path.stat().st_size / 1024
    print(f"  Wrote {counties_path} ({size_kb:.0f} KB)\n")

    # Step 4.3
    print("Downloading township boundaries...")
    townships = download_townships()
    townships_path = OUTPUT_DIR / "townships.geojson"
    with open(townships_path, "w") as f:
        json.dump(townships, f)
    size_kb = townships_path.stat().st_size / 1024
    print(f"  Wrote {townships_path} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    import urllib.parse
    main()
