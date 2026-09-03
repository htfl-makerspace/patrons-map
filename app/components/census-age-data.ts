// Haverford Township age distribution from U.S. Census Bureau
// Source: ACS 5-Year Estimates (2024), Table B01001 (Sex by Age)
// Geography: Haverford township, Delaware County, Pennsylvania
// GEOID: 4204533144 (county subdivision)
// API: https://api.census.gov/data/2024/acs/acs5 with ucgid=0600000US4204533144
//
// TODO: In the future, swap this hardcoded data for a live Census API call.
// The API endpoint and variable mapping are documented above.
// The key env var is VITE_CENSUS_API_KEY.
// When doing so, fetch B01001 variables 003-025 (male) and 027-049 (female),
// then aggregate into the age groups below.

export const AGE_GROUP_KEYS = ["0-9", "10-17", "18-34", "35-64", "65+"] as const
export type AgeGroupKey = (typeof AGE_GROUP_KEYS)[number]

export const AGE_GROUP_LABELS: Record<AgeGroupKey, string> = {
  "0-9": "0–9",
  "10-17": "10–17",
  "18-34": "18–34",
  "35-64": "35–64",
  "65+": "65+",
}

export const AGE_GROUP_COLORS: Record<AgeGroupKey, string> = {
  "0-9": "#f59e0b",    // amber
  "10-17": "#06b6d4",  // cyan
  "18-34": "#8b5cf6",  // violet
  "35-64": "#ef4444",  // red
  "65+": "#22c55e",    // green
}

// B01001 variable mapping:
// Male:   003=Under5, 004=5-9, 005=10-14, 006=15-17, 007=18-19, 008=20, 009=21,
//         010=22-24, 011=25-29, 012=30-34, 013=35-39, 014=40-44, 015=45-49,
//         016=50-54, 017=55-59, 018=60-61, 019=62-64, 020=65-66, 021=67-69,
//         022=70-74, 023=75-79, 024=80-84, 025=85+
// Female: 027=Under5, 028=5-9, 029=10-14, 030=15-17, 031=18-19, 032=20, 033=21,
//         034=22-24, 035=25-29, 036=30-34, 037=35-39, 038=40-44, 039=45-49,
//         040=50-54, 041=55-59, 042=60-61, 043=62-64, 044=65-66, 045=67-69,
//         046=70-74, 047=75-79, 048=80-84, 049=85+
export const HAVERFORD_CENSUS_AGE: Record<AgeGroupKey, number> = {
  "0-9": 6507,     // Under5 + 5-9 (male + female)
  "10-17": 5941,   // 10-14 + 15-17
  "18-34": 9106,   // 18-19 + 20 + 21 + 22-24 + 25-29 + 30-34
  "35-64": 19566,  // 35-39 + 40-44 + 45-49 + 50-54 + 55-59 + 60-61 + 62-64
  "65+": 9754,     // 65-66 + 67-69 + 70-74 + 75-79 + 80-84 + 85+
}

export const HAVERFORD_CENSUS_TOTAL = 50874
