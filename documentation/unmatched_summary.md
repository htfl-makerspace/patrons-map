# Unmatched Address Analysis

## Overview

Out of **21,014** total patron addresses geocoded through the US Census Geocoder, **20,303 matched** (96.6%) and **711 did not match** (3.4%).

| Status   | Count | % of Total |
|----------|-------|------------|
| Match    | 20,303 | 96.6%    |
| No_Match | 606    | 2.9%     |
| Tie      | 105    | 0.5%     |

- **No_Match**: The geocoder could not find the address in its database.
- **Tie**: The geocoder found multiple equally likely matches and could not determine the correct one.

---

## Pattern Breakdown

| Category | Count | % of Unmatched | Description |
|----------|-------|----------------|-------------|
| 400 Glendale Rd (institutional) | 151 | 21.2% | Single institutional address with many unit variations |
| Incomplete street name (`### Rd`) | 108 | 15.2% | Street name missing, only house number + "Rd" |
| St/Saint ambiguity (Tie) | 35 | 4.9% | "St" interpreted as both "Street" and "Saint" |
| Empty address | 30 | 4.2% | Completely blank — just `, , PA, ` |
| Missing city or zip | 17 | 2.4% | City and/or zip code field is empty |
| Non-standard (PO Box, Homebound) | 12 | 1.7% | PO Boxes, "Sp Homebound", and similar |
| Other Tie | 62 | 8.7% | Ambiguous addresses that produced ties |
| Other No_Match | 296 | 41.6% | Addresses that appear valid but didn't match |
