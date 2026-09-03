/**
 * Generate SQL to import census boundary GeoJSON files into PostGIS tables,
 * then execute via supabase CLI.
 *
 * Usage:
 *   npx tsx scripts/import-boundaries.ts
 */

import { readFileSync, writeFileSync } from "fs"
import { resolve } from "path"
import { execSync } from "child_process"

const ROOT = resolve(__dirname, "..")

function escapeSQL(s: string): string {
  return s.replace(/'/g, "''")
}

function toMultiPolygon(geometry: GeoJSON.Geometry): GeoJSON.MultiPolygon | null {
  if (geometry.type === "MultiPolygon") return geometry
  if (geometry.type === "Polygon") {
    return { type: "MultiPolygon", coordinates: [geometry.coordinates] }
  }
  // Skip non-polygon geometries (e.g. MultiLineString border-only features)
  return null
}

function generateSQL(): string {
  const lines: string[] = []

  // Block groups
  const bgPath = resolve(ROOT, "app/public/data/blockgroups.geojson")
  const bgFC: GeoJSON.FeatureCollection = JSON.parse(readFileSync(bgPath, "utf-8"))

  for (const f of bgFC.features) {
    const p = f.properties!
    const geom = toMultiPolygon(f.geometry)
    if (!geom) continue
    const geomJson = escapeSQL(JSON.stringify(geom))
    lines.push(
      `INSERT INTO census_block_groups (geoid, tract, bg, population, median_income, per_capita_income, mean_income, geom)` +
      ` VALUES ('${p.GEOID}', '${p.tract}', '${p.bg}', ${p.population ?? 'NULL'}, ${p.median_income ?? 'NULL'}, ${p.per_capita_income ?? 'NULL'}, ${p.mean_income ?? 'NULL'}, ST_SetSRID(ST_GeomFromGeoJSON('${geomJson}'), 4326))` +
      ` ON CONFLICT (geoid) DO UPDATE SET tract=EXCLUDED.tract, bg=EXCLUDED.bg, population=EXCLUDED.population, median_income=EXCLUDED.median_income, per_capita_income=EXCLUDED.per_capita_income, mean_income=EXCLUDED.mean_income, geom=EXCLUDED.geom;`
    )
  }

  // Tracts
  const tractPath = resolve(ROOT, "app/public/data/tracts.geojson")
  const tractFC: GeoJSON.FeatureCollection = JSON.parse(readFileSync(tractPath, "utf-8"))

  for (const f of tractFC.features) {
    const p = f.properties!
    const geom = toMultiPolygon(f.geometry)
    if (!geom) { console.log(`  Skipping tract ${p.GEOID} (${f.geometry.type})`); continue }
    const geomJson = escapeSQL(JSON.stringify(geom))
    lines.push(
      `INSERT INTO census_tracts (geoid, name, tract, state, county, geom)` +
      ` VALUES ('${p.GEOID}', '${escapeSQL(p.NAME ?? '')}', '${p.TRACT}', '${p.STATE}', '${p.COUNTY}', ST_SetSRID(ST_GeomFromGeoJSON('${geomJson}'), 4326))` +
      ` ON CONFLICT (geoid) DO UPDATE SET name=EXCLUDED.name, tract=EXCLUDED.tract, state=EXCLUDED.state, county=EXCLUDED.county, geom=EXCLUDED.geom;`
    )
  }

  return lines.join("\n")
}

const sql = generateSQL()
const tmpFile = resolve(ROOT, "scripts/.tmp-import.sql")
writeFileSync(tmpFile, sql)
console.log(`Generated ${sql.split("\n").length} INSERT statements`)
console.log("Executing via supabase CLI...")

try {
  const sqlContent = readFileSync(tmpFile, "utf-8")
  const result = execSync(
    `npx supabase db query --linked`,
    { cwd: ROOT, input: sqlContent, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 50 * 1024 * 1024 }
  )
  console.log(result.toString())
  console.log("Import complete!")
} catch (e: any) {
  console.error("Error executing SQL:", e.stderr?.toString() || e.message)
  process.exit(1)
} finally {
  // Clean up temp file
  try { require("fs").unlinkSync(tmpFile) } catch {}
}
