# Unmatched Address Analysis — Detailed Patterns

## Key Patterns

### 1. 400 Glendale Rd — 151 addresses (21.2%)

This is a single location (likely an apartment complex or institutional facility) at **400 Glendale Rd, Havertown, PA 19083**. The Census geocoder does not recognize it, likely because it is a non-standard residential address or the building is not in the Census TIGER database.

Variations include:
- `400 Glendale Rd` (87x) — base address, no unit
- `400 Glendale Road` (12x) — spelled out
- `400 Glendale Rd.` (7x) — with period
- Unit suffixes like `B12`, `C#44`, `G-23`, `I-43`, `K45`, etc.
- Some have the unit number placed in the city field (e.g., `400 Glendale Rd, K12, PA, 19083`)

### 2. Incomplete Street Names — 108 addresses (15.2%)

These addresses are missing the street name entirely, showing only a house number followed by "Rd" or "Road". This is a data quality issue from the source system.

Examples:
- `904 Rd, Havertown, PA, 19083`
- `1024 Rd, Havertown, PA, 19083`
- `1208 Road, Havertown, PA, 19083`
- `1311 Rd, Havertown, PA, 19083` (5 occurrences)

All 108 are in Havertown, suggesting a systematic data entry issue for a specific area or import batch.

### 3. Maryland Ave, Havertown — 35 addresses

All 35 Maryland Ave addresses in Havertown returned No_Match. House numbers range from 1311–1453. This suggests the entire block may not exist in the Census TIGER/Line database, possibly a newer development or a street name discrepancy.

### 4. Highland Ln, Bryn Mawr — 19 addresses

All Highland Ln/Lane addresses in Bryn Mawr (19010) returned No_Match. This may indicate the street is not recognized under that name in Census records, or it falls in an area with addressing inconsistencies.

### 5. E Township Line Rd — 25 addresses

Multiple variations of East Township Line Road in Havertown failed to match. Contributing factors:
- Directional prefix variations: `E`, `East`, `E.`
- Suffix variations: `Rd`, `Road`, `Line` (missing `Rd`)
- Typos: `112 Easr Township Line Road`
- PO Box mixed in: `328 E Township Line Rd, Po Box, PA, 19083`

### 6. St/Saint Ambiguity — 35 Tie results

Addresses containing "St" caused Ties because the geocoder cannot determine if "St" means "Street" or "Saint":
- `2418 St Denis Ln` / `2430 Saint Denis Ln` — St Denis Lane
- `2727 St Marys Rd` / `2723 St Mary'S Rd` — St Marys Road
- Inconsistent use of `St`, `Saint`, `St.` across records

### 7. Empty / Missing Data — 47 addresses

- **30** completely empty addresses: `, , PA, `
- **17** missing city and/or zip code
- These are data quality issues from the source system

### 8. Non-Standard Addresses — 12 addresses

- `Sp Homebound` — special education designation, not a real address
- PO Boxes — not geocodable to a physical location

---

## Recommendations

1. **400 Glendale Rd**: Manually geocode this single location and apply coordinates to all 151 records. Strip unit numbers before geocoding.
2. **Incomplete streets (`### Rd`)**: Cross-reference the 108 records with the source system to recover the missing street names.
3. **Maryland Ave & Highland Ln**: Verify these streets exist in the expected municipality. They may be mapped under a different jurisdiction or name in Census records. Consider using an alternative geocoder (Google Maps, Nominatim) for these.
4. **Township Line Rd**: Standardize the directional prefix and suffix, then re-geocode.
5. **St/Saint addresses**: Replace `St` with `Saint` (or vice versa) and re-geocode to resolve Ties.
6. **Empty addresses**: Flag for data cleanup in the source system — these cannot be geocoded.
7. **PO Boxes / Homebound**: Exclude from geocoding or flag separately as non-geocodable.

---

## City Distribution of Unmatched Addresses

| City | Count |
|------|-------|
| Havertown | 500 |
| Ardmore | 40 |
| Haverford | 37 |
| Bryn Mawr | 33 |
| Drexel Hill | 9 |
| Newtown Square | 4 |
| Wynnewood | 4 |
| Broomall | 2 |
| Upper Darby | 2 |
| Lansdowne | 2 |
| Other | 78 |

The heavy concentration in Havertown (70.3% of unmatched) is partly driven by the 400 Glendale Rd and incomplete street name issues.
