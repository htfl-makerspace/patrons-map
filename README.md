# HTFL Strategic Planning

Patron data pipeline and interactive map for Havertown Free Library. Raw patron records are cleaned, geocoded, stored in Supabase, and served as a map visualization.

## Project Structure

```
strategic planning/
├── jupyter/                        # Data cleaning & analysis
│   ├── analysis.ipynb              # Main notebook (cleaning, charts, CSV export)
│   └── data/
│       ├── raw_txt/                # Raw patron exports (tab-delimited)
│       ├── processing_csv/         # Intermediate CSVs
│       └── cleaned_csv/
│           └── patron_ha_cleaned.csv   # Final cleaned output
│
├── app/                            # React frontend + backend scripts
│   ├── components/
│   │   ├── map.tsx                 # MapLibre GL map with all layers
│   │   ├── map-controls.tsx        # Layer toggles + choropleth radio group
│   │   ├── info-panel.tsx          # Legend + data sources panel
│   │   ├── time-filter.tsx         # Date range slider for patron dots
│   │   ├── choropleth-config.ts    # Shared choropleth metric definitions
│   │   └── app-header.tsx          # Logo, title, sign-out
│   ├── scripts/
│   │   ├── upload_csv.py           # Upload cleaned CSV to Supabase (upsert)
│   │   ├── geocode_patrons.py      # Geocode addresses via Mapbox batch API
│   │   ├── preprocess_unmatched.py # Filter & clean unmatched addresses for Google
│   │   ├── validate_addresses.py   # Validate/correct addresses via Google API
│   │   ├── fetch_census_blockgroups.py # Fetch ACS demographics + TIGER boundaries
│   │   ├── export_geojson.py       # Export GeoJSON from Supabase
│   │   ├── download_boundaries.py  # Download boundary shapefiles
│   │   └── results/                # Geocoding audit CSVs
│   ├── public/data/                # Static boundary & census GeoJSON
│   │   ├── blockgroups.geojson     # Block group polygons + demographics
│   │   ├── tracts.geojson          # Census tract boundaries
│   │   ├── townships.geojson       # Township boundaries
│   │   └── counties.geojson        # County boundaries
│   ├── routes/                     # TanStack Router pages (/, /login)
│   ├── .env                        # API keys (gitignored)
│   └── vite.config.ts
│
├── supabase/
│   ├── functions/
│   │   └── patrons-geojson/        # Edge function: serves GeoJSON to the map
│   └── config.toml
│
└── documentation/                  # Analysis notes & reference
    └── unmatched_analysis.md       # Patterns in unmatched addresses
```

## Data Pipeline

The pipeline has four stages. Each can be run independently.

```
[1] Clean data     [2] Upload to        [3] Geocode          [3.5] Preprocess &         [4] View on map
 (notebook)  --->   Supabase       --->  (geocode_patrons.py)  Google validate     --->   (app / edge fn)
                   (upload_csv.py)            |                (preprocess_unmatched.py)
                        |               Mapbox batch API       (validate_addresses.py)
                   patron_ha_cleaned.csv                            |
                                                             Google Address API

         [C] Census data (independent, run as needed)
              fetch_census_blockgroups.py  --->  blockgroups.geojson
              (ACS 5-Year + TIGER/Line)          (static, checked into repo)
```

### Stage 1: Clean Data (Jupyter Notebook)

The notebook (`jupyter/analysis.ipynb`) reads raw patron exports, cleans addresses, fixes typos, normalizes formatting, and exports to CSV.

```bash
cd jupyter
source .venv/bin/activate
jupyter notebook analysis.ipynb
```

Key cleaning steps in the notebook (step 9b):
- Fix typos (Ddarby -> Darby, Havertowm -> Havertown, etc.)
- Normalize St/Saint ambiguity (St Denis -> Saint Denis)
- Standardize Township Line Rd variants
- Strip unit numbers from 400 Glendale Rd
- Remove trailing dots (Rd. -> Rd, E. -> E)
- Split stuck house numbers (537Barrett -> 537 Barrett)

Output: `jupyter/data/cleaned_csv/patron_ha_cleaned.csv`

### Stage 2: Upload to Supabase

`upload_csv.py` upserts the cleaned CSV to Supabase. Existing barcodes get their columns updated; new barcodes are inserted.

```bash
cd app/scripts
source ../../jupyter/.venv/bin/activate

# Upload to dev table (default)
python3 upload_csv.py

# Upload to prod table
python3 upload_csv.py --table patron_ha

# Strip coordinates (before re-geocoding)
python3 upload_csv.py --strip-coords
python3 upload_csv.py --strip-coords --table patron_ha

# Use a different CSV
python3 upload_csv.py --csv /path/to/other.csv
```

### Stage 3: Geocode

`geocode_patrons.py` geocodes all rows where `latitude IS NULL` using the Mapbox Geocoding v6 batch API (1000 addresses per request).

```bash
cd app/scripts

# Geocode ungeocoded rows in dev table (default)
python3 geocode_patrons.py

# Geocode in prod table
python3 geocode_patrons.py --table patron_ha

# Test with a sample first
python3 geocode_patrons.py test 200
python3 geocode_patrons.py test 200 --table patron_ha
```

Results are written to `app/scripts/results/mapbox_results.csv` for audit.

### Stage 3.5: Preprocess & Validate Geocode Failures (Google)

Two scripts work together: `preprocess_unmatched.py` filters out definitely-unresolvable addresses and cleans junk prefixes, then `validate_addresses.py` sends the survivors to Google for correction.

**Step 1: Preprocess** — filter and clean the unmatched CSV:

```bash
cd app/scripts

# Preprocess (reads results/unmatched_remaining.csv by default)
python3 preprocess_unmatched.py
```

This discards addresses that can't be resolved:
- Empty addresses (no data at all)
- Number-only addresses (house number but no street name, e.g. "1000, Havertown, Pa 19083")
- No house number (street name only, e.g. "Carter Rd, Haverford")
- Incomplete directionals (e.g. "115 E., Lansdowne")
- PO Boxes

And cleans salvageable addresses by stripping:
- `*Mail Returned*` prefixes
- `Mail Ret'D <date>` prefixes
- `Ah@Ud` and similar junk tokens
- Building/complex name prefixes (e.g. "Wallingford Apartments I-2, 1925 Lawrence Road" → "1925 Lawrence Road")

Outputs: `results/unmatched_for_google.csv` (resolvable) and `results/unmatched_discarded.csv` (unresolvable).

**Step 2: Google Validate** — send preprocessed addresses to Google:

```bash
# Preview corrections without updating Supabase
python3 validate_addresses.py --csv results/unmatched_for_google.csv --dry-run

# Apply corrections to dev table (default)
python3 validate_addresses.py --csv results/unmatched_for_google.csv

# Apply corrections to prod table
python3 validate_addresses.py --csv results/unmatched_for_google.csv --table patron_ha

# Then re-geocode the corrected addresses
python3 geocode_patrons.py
```

Google Address Validation can:
- Fix wrong street suffixes (Ave vs Rd vs Dr)
- Add or correct directionals (W, E, N, S)
- Fix street name typos
- Separate unit/apt info from the street address
- Return "not found" for truly invalid addresses

Pricing: $0.017/request with $200/month free credit (~11,700 free validations).

Audit results are written to `app/scripts/results/google_validation.csv`.

### Census Block Group Data

`fetch_census_blockgroups.py` fetches ACS 5-Year Estimates (2022) and TIGER/Line boundaries for the 24 census tracts covering Haverford Township. It joins demographic data to block group polygons and outputs `blockgroups.geojson`.

```bash
cd app/scripts
source ../../jupyter/.venv/bin/activate
python3 fetch_census_blockgroups.py
```

Variables fetched:
- B01003: Total population
- B19025/B11001: Mean household income (aggregate income / households)
- B19013: Median household income
- B19301: Per capita income

Output: `app/public/data/blockgroups.geojson` (74 block groups with demographics + polygon boundaries)

### Stage 4: View on Map

The React app renders an interactive map with patron data and census demographics.

```bash
cd app
npm run dev
```

**Map features:**

- **Patron dots** — fetched from the Supabase edge function (`patrons-geojson`) with auth. Each dot is clickable for address details.
- **Choropleth layers** — mutually exclusive radio selection:
  - Penetration rate (patron count / population, computed client-side)
  - Mean household income
  - Median household income
  - Per capita income
- **Boundary layers** — toggleable overlays for census tracts, townships, and Delaware County border. Haverford Township is highlighted.
- **Block group popups** — clicking a block group shows population, all income metrics, patron count, and penetration rate.
- **Time filter** — date range slider to filter patron dots by account creation date.
- **Info panel** — dynamic legend (updates with active layers), geocoding confidence breakdown, and data source documentation.
- **Authentication** — Supabase auth with a login page; patron data requires a valid session.

## Dev/Prod Table Strategy

The project uses a **shadow table** approach:

| Table | Purpose |
|-------|---------|
| `patron_ha` | **Production** — the edge function reads from this |
| `patron_ha_dev` | **Development** — upload and geocode here first |

All scripts default to `patron_ha_dev`. Use `--table patron_ha` to target production.

### Promoting dev to prod

Once dev data looks good, swap tables in the Supabase SQL editor:

```sql
BEGIN;
ALTER TABLE patron_ha RENAME TO patron_ha_old;
ALTER TABLE patron_ha_dev RENAME TO patron_ha;
COMMIT;
```

To roll back: rename `patron_ha_old` back to `patron_ha`. Drop `_old` when satisfied.

### Creating the dev table

Run this in the Supabase SQL editor to create `patron_ha_dev` with the same schema:

```sql
CREATE TABLE patron_ha_dev (LIKE patron_ha INCLUDING ALL);
```

## Common Workflows

### Full refresh (new raw data)

```bash
# 1. Run notebook to clean data and export CSV
# 2. Upload to dev
python3 upload_csv.py
# 3. Strip old coordinates
python3 upload_csv.py --strip-coords
# 4. Geocode
python3 geocode_patrons.py
# 5. Preprocess unmatched addresses (filter & clean)
python3 preprocess_unmatched.py
# 6. Validate and correct via Google
python3 validate_addresses.py --csv results/unmatched_for_google.csv
# 7. Re-geocode corrected addresses
python3 geocode_patrons.py
# 8. Verify on map, then promote dev -> prod
```

### Update addresses only (no re-geocoding)

```bash
# 1. Run notebook, export CSV
# 2. Upload to dev (coordinates are preserved)
python3 upload_csv.py
```

### Re-geocode everything

```bash
# 1. Strip coordinates
python3 upload_csv.py --strip-coords
# 2. Geocode all rows
python3 geocode_patrons.py
```

## Supabase Schema

```sql
CREATE TABLE patron_ha (
  barcode              BIGINT PRIMARY KEY,
  address              TEXT,
  zip                  VARCHAR(10),
  birth_date           DATE,
  date_issued          DATE,
  circ_active          DATE,
  created              DATE,
  p_type               SMALLINT,
  pat_agency           SMALLINT,
  issuing_lib          VARCHAR(4),
  card_at              SMALLINT,
  cur_chkout           INTEGER DEFAULT 0,
  tot_chkout           INTEGER DEFAULT 0,
  latitude             DOUBLE PRECISION,
  longitude            DOUBLE PRECISION,
  geocode_accuracy     TEXT,        -- rooftop | parcel | point | interpolated | approximate
  geocode_confidence   TEXT         -- exact | high | medium | low
);
```

The `geocode_accuracy` and `geocode_confidence` columns must exist before geocoding. Add them if missing:

```sql
ALTER TABLE patron_ha ADD COLUMN IF NOT EXISTS geocode_accuracy text;
ALTER TABLE patron_ha ADD COLUMN IF NOT EXISTS geocode_confidence text;
```

### Access control

Migrations in `supabase/migrations/` (applied with `supabase db query --linked -f <file>`) lock the database down:

- Every table in `public` has RLS enabled with a single read-only policy for signed-in users; `anon` has no table access. The edge function and Python scripts use the service role key, which bypasses both.
- PostGIS lives in the `extensions` schema (not `public`), so `spatial_ref_sys` and friends don't trigger the "RLS disabled" advisor warning.
- `public.keepalive()` is the only thing `anon` can call (used by the Railway keep-alive cron).
- Email signup is disabled in the dashboard; accounts are created by an admin.

Never commit patron exports — `*.csv` is gitignored for that reason.

## Supabase Keep-Alive (Railway Cron)

Supabase pauses free-tier projects after 7 days of inactivity. `keepalive/` is a dependency-free Node script that Railway runs as a cron job every 3 days (`0 12 */3 * *`, UTC). It calls the `public.keepalive()` Postgres function (defined in `supabase/migrations/`), so the request actually reaches Postgres without touching patron data.

Railway setup:
1. New service → deploy from this GitHub repo
2. Settings → Root Directory: `keepalive` (picks up `keepalive/railway.json` for the start command and cron schedule)
3. Variables: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`

A failed ping exits non-zero, so it shows up as a failed run in Railway.

Test it locally:
```bash
cd keepalive
set -a; source ../app/.env; set +a
node index.mjs
```

## Environment Variables

Stored in `app/.env` (gitignored):

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Service role key (server-side scripts) |
| `SUPABASE_PUBLISHABLE_KEY` | Anon key (client-side) |
| `VITE_SUPABASE_URL` | Same URL, exposed to Vite |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Same anon key, exposed to Vite |
| `VITE_MAPBOX_API_KEY` | Mapbox public token (map tiles + geocoding) |
| `VITE_MAPTILER_API_KEY` | MapTiler key (base map style) |
| `GOOGLE_ADDRESS_VALIDATION_KEY` | Google Maps API key (Address Validation API enabled) |

## Dependencies

**Python** (data pipeline):
```bash
cd jupyter && source .venv/bin/activate
pip install pandas supabase python-dotenv requests plotly fiona
```

**Node** (frontend):
```bash
cd app && npm install
```
