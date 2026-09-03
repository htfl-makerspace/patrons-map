import { useRef, useEffect, useState } from "react"
import maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { supabase } from "~/lib/supabase"
import centroid from "@turf/centroid"
import bbox from "@turf/bbox"
import intersect from "@turf/intersect"
import { polygon as turfPolygon, featureCollection } from "@turf/helpers"

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_API_KEY
const STYLE_URL = `https://api.maptiler.com/maps/019fd78b-3953-7f1b-b928-526772f25070/style.json?key=${MAPTILER_KEY}`
const PATRONS_GEOJSON_URL =
  "https://nyucgaypvzmfqbfnufxc.supabase.co/functions/v1/patrons-geojson"

// Map palette
const COLORS = {
  county: "#90a500", // slate — Delaware County border
  township: "#94a3b8", // light slate — other township borders
  haverford: "#615ed6", // amber — Haverford township border
  dots: "#f00068", // teal — patron dots
  tracts: "#fbbf24", // amber light — census tract lines
} as const

// --- Age distribution colors and utilities ---
import { AGE_GROUP_KEYS, AGE_GROUP_LABELS, AGE_GROUP_COLORS } from "./census-age-data"
import type { AgeGroupKey } from "./census-age-data"

const UNKNOWN_COLOR = "#d1d5db"

type AgeCounts = Record<AgeGroupKey | "unknown", number>

function emptyAgeCounts(): AgeCounts {
  return { "0-9": 0, "10-17": 0, "18-34": 0, "35-64": 0, "65+": 0, unknown: 0 }
}

function ageCountsTotal(counts: AgeCounts): number {
  return Object.values(counts).reduce((a, b) => a + b, 0)
}

function piePopupHtml(counts: AgeCounts, label: string): string {
  const total = ageCountsTotal(counts)
  const pct = (n: number) => total > 0 ? ((n / total) * 100).toFixed(1) : "0"
  let rows = ""
  for (const key of AGE_GROUP_KEYS) {
    rows += `<div><span style="color:${AGE_GROUP_COLORS[key]}">&#9679;</span> ${AGE_GROUP_LABELS[key]}: ${counts[key].toLocaleString()} (${pct(counts[key])}%)</div>`
  }
  if (counts.unknown > 0) {
    rows += `<div><span style="color:${UNKNOWN_COLOR}">&#9679;</span> Unknown: ${counts.unknown.toLocaleString()} (${pct(counts.unknown)}%)</div>`
  }
  return `<div style="font-size:12px;line-height:1.6">
    <div style="font-weight:700;margin-bottom:2px">${label}</div>
    <div style="margin-bottom:2px">${total.toLocaleString()} patrons</div>
    ${rows}
  </div>`
}

// Split a polygon into vertical sub-polygons proportional to age group sizes
const FILL_KEYS: (keyof AgeCounts)[] = [...AGE_GROUP_KEYS, "unknown"]

function ageGroupColor(key: string): string {
  return AGE_GROUP_COLORS[key as AgeGroupKey] ?? UNKNOWN_COLOR
}

function splitPolygonByAge(
  feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  counts: AgeCounts,
  level: string,
  label: string,
): GeoJSON.Feature[] {
  const total = ageCountsTotal(counts)
  if (total === 0) return []

  const [minX, minY, maxX, maxY] = bbox(feature)
  const width = maxX - minX
  const results: GeoJSON.Feature[] = []
  let currentX = minX

  for (const key of FILL_KEYS) {
    const count = counts[key]
    if (count === 0) continue
    const fraction = count / total
    const sliceMaxX = currentX + width * fraction

    // Create a rectangle for this slice
    const rect = turfPolygon([[
      [currentX, minY],
      [sliceMaxX, minY],
      [sliceMaxX, maxY],
      [currentX, maxY],
      [currentX, minY],
    ]])

    try {
      const clipped = intersect(featureCollection([feature as any, rect as any]))
      if (clipped) {
        results.push({
          ...clipped,
          properties: {
            age_group: key,
            color: ageGroupColor(key),
            level,
            label,
            total,
            ...counts,
          },
        })
      }
    } catch {
      // Skip polygons that fail intersection (degenerate geometries)
    }
    currentX = sliceMaxX
  }

  return results
}

const DELAWARE_COUNTY_CENTER: [number, number] = [-75.35, 39.92]
const HTFL_COORDS: [number, number] = [-75.30486, 39.981521]
const DEFAULT_ZOOM = 11

interface MapProps {
  onMapReady?: (map: maplibregl.Map) => void
}

export default function Map({ onMapReady }: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingStatus, setLoadingStatus] = useState("Loading map…")

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: DELAWARE_COUNTY_CENTER,
      zoom: DEFAULT_ZOOM,
      minZoom: 8,
      maxBounds: [
        [-76.5, 39.2], // southwest corner
        [-74.2, 40.7], // northeast corner
      ],
    })

    map.addControl(new maplibregl.NavigationControl(), "bottom-right")

    map.on("load", async () => {
      setLoadingStatus("Loading patron data…")
      // Fetch patron data with auth token
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const emptyCollection = {
        type: "FeatureCollection" as const,
        features: [],
      }

      let geojsonData = emptyCollection
      if (session) {
        const res = await fetch(PATRONS_GEOJSON_URL, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        })
        if (res.ok) {
          geojsonData = await res.json()
          console.log(geojsonData)
        }
      }

      map.addSource("patrons", {
        type: "geojson",
        data: geojsonData,
      })

      map.addLayer({
        id: "patron-dots",
        type: "circle",
        source: "patrons",
        paint: {
          "circle-radius": 3,
          "circle-color": COLORS.dots,
          "circle-opacity": 0.6,
        },
      })

      // Power user highlights layer (500+ lifetime checkouts)
      map.addLayer({
        id: "power-user-dots",
        type: "circle",
        source: "patrons",
        filter: [">=", ["get", "tot_chkout"], 500],
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["get", "tot_chkout"],
            500, 4,
            2000, 7,
            5000, 10,
          ],
          "circle-color": "#facc15",
          "circle-opacity": 0.85,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#a16207",
        },
        layout: {
          visibility: "none",
        },
      })

      // Popup on click for patron dots
      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: true,
      })

      map.on("click", "patron-dots", (e) => {
        if (!e.features?.length) return
        const feature = e.features[0]
        console.log("e.features[0]", e.features[0])
        const coords = (
          feature.geometry as GeoJSON.Point
        ).coordinates.slice() as [number, number]
        const address = feature.properties?.address ?? "Unknown address"

        popup
          .setLngLat(coords)
          .setHTML(`<div style="font-size:13px">${address}</div>`)
          .addTo(map)
      })

      map.on("mouseenter", "patron-dots", () => {
        map.getCanvas().style.cursor = "pointer"
      })
      map.on("mouseleave", "patron-dots", () => {
        map.getCanvas().style.cursor = ""
      })

      setLoadingStatus("Loading boundaries…")

      // Block group choropleth (added below patron dots, will reorder after)
      map.addSource("blockgroups", {
        type: "geojson",
        data: `${import.meta.env.BASE_URL}data/blockgroups.geojson`,
      })

      map.addLayer(
        {
          id: "blockgroup-fill",
          type: "fill",
          source: "blockgroups",
          paint: {
            "fill-color": [
              "interpolate",
              ["linear"],
              ["get", "penetration"],
              0,
              "#d73027",
              10,
              "#f46d43",
              20,
              "#fdae61",
              30,
              "#fee08b",
              40,
              "#d9ef8b",
              50,
              "#a6d96a",
              60,
              "#66bd63",
              70,
              "#1a9850",
            ],
            "fill-opacity": 0.5,
          },
          layout: {
            visibility: "none",
          },
        },
        "patron-dots",
      )

      map.addLayer(
        {
          id: "blockgroup-borders",
          type: "line",
          source: "blockgroups",
          paint: {
            "line-color": "#999",
            "line-width": 0.5,
          },
          layout: {
            visibility: "none",
          },
        },
        "patron-dots",
      )

      // Block group borders — always visible at high zoom (independent of choropleth)
      map.addLayer(
        {
          id: "blockgroup-borders-auto",
          type: "line",
          source: "blockgroups",
          paint: {
            "line-color": "#999",
            "line-width": 0.5,
          },
          minzoom: 13,
        },
        "patron-dots",
      )

      // Highlight layer for selected block group (above patron-dots so it's visible)
      map.addLayer({
        id: "blockgroup-highlight",
        type: "line",
        source: "blockgroups",
        paint: {
          "line-color": "#f59e0b",
          "line-width": 4,
        },
        filter: ["==", ["get", "GEOID"], ""],
        layout: {
          visibility: "none",
        },
      })

      // Pre-compute patron counts per block group once all sources load
      const patronCountsByGeoid: Record<string, number> = {}

      // Age-fill sources — one per geographic level, rendered as polygon fills
      const AGE_FILL_LEVELS = ["township", "tract", "blockgroup"] as const
      for (const level of AGE_FILL_LEVELS) {
        map.addSource(`age-fill-${level}`, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        })
        map.addLayer(
          {
            id: `age-fill-${level}`,
            type: "fill",
            source: `age-fill-${level}`,
            paint: {
              "fill-color": ["get", "color"],
              "fill-opacity": 0.55,
            },
            layout: { visibility: "none" },
          },
          "patron-dots",
        )
        map.addLayer(
          {
            id: `age-fill-${level}-outline`,
            type: "line",
            source: `age-fill-${level}`,
            paint: {
              "line-color": "#ffffff",
              "line-width": 1,
            },
            layout: { visibility: "none" },
          },
          "patron-dots",
        )
      }

      // Label markers for age fills (show patron count at centroid)
      const ageFillLabels: maplibregl.Marker[] = []

      const computePatronCounts = () => {
        const patronSrc = map.getSource("patrons") as maplibregl.GeoJSONSource | undefined
        const bgSrc = map.getSource("blockgroups") as maplibregl.GeoJSONSource | undefined
        const tractSrc = map.getSource("tracts") as maplibregl.GeoJSONSource | undefined
        const townshipSrc = map.getSource("townships") as maplibregl.GeoJSONSource | undefined
        if (!patronSrc || !bgSrc || !tractSrc || !townshipSrc) return

        Promise.all([
          patronSrc.getData(),
          bgSrc.getData(),
          tractSrc.getData(),
          townshipSrc.getData(),
        ]).then(([patronData, bgData, tractData, townshipData]) => {
          if (!patronData || !("features" in patronData)) return
          if (!bgData || !("features" in bgData)) return
          if (!tractData || !("features" in tractData)) return
          if (!townshipData || !("features" in townshipData)) return

          // Find Haverford Township boundary for clipping
          const haverfordFeat = townshipData.features.find(
            (f) => f.properties?.NAME === "Haverford township"
          )

          // Derive export date from the data (latest created date)
          let exportTime = 0
          for (const f of patronData.features) {
            const t = new Date(f.properties?.created as string ?? 0).getTime()
            if (t > exportTime) exportTime = t
          }
          const exportDate = new Date(exportTime)
          const cutoff12m = new Date(exportDate)
          cutoff12m.setFullYear(cutoff12m.getFullYear() - 1)

          // --- Single pass: group patrons by pre-assigned geoids ---
          const bgAgeCounts: Record<string, AgeCounts> = {}
          const tractAgeCounts: Record<string, AgeCounts> = {}
          const townshipAges = emptyAgeCounts()
          const bgCheckouts: Record<string, number[]> = {}
          const bgTotalCount: Record<string, number> = {}
          const bgActiveCount: Record<string, number> = {}
          const bgActiveZeroChk: Record<string, number> = {}
          const bgPowerCount: Record<string, number> = {}

          for (const pFeat of patronData.features) {
            const props = pFeat.properties!
            const bgId = props.block_group_geoid as string | undefined
            const tractId = props.census_tract_geoid as string | undefined
            const ag = (props.age_group as string) || "unknown"
            const chk = (props.tot_chkout as number) ?? 0

            // Classify activity status relative to export date
            const circ = props.circ_active ? new Date(props.circ_active as string) : null
            const activityStatus = circ
              ? (circ >= cutoff12m ? "active" : "lapsed")
              : "dormant"

            if (bgId) {
              bgAgeCounts[bgId] ??= emptyAgeCounts()
              if (ag in bgAgeCounts[bgId]) bgAgeCounts[bgId][ag as keyof AgeCounts]++
              else bgAgeCounts[bgId].unknown++

              // Any patron with a block_group_geoid is inside Haverford
              if (ag in townshipAges) townshipAges[ag as keyof AgeCounts]++
              else townshipAges.unknown++

              // Checkout values for median
              bgCheckouts[bgId] ??= []
              bgCheckouts[bgId].push(chk)

              // Active/total counts
              bgTotalCount[bgId] = (bgTotalCount[bgId] ?? 0) + 1
              if (activityStatus === "active") {
                bgActiveCount[bgId] = (bgActiveCount[bgId] ?? 0) + 1
                if (chk === 0) bgActiveZeroChk[bgId] = (bgActiveZeroChk[bgId] ?? 0) + 1
              }

              // Power user count (500+ lifetime checkouts)
              if (chk >= 500) bgPowerCount[bgId] = (bgPowerCount[bgId] ?? 0) + 1
            }

            if (tractId) {
              tractAgeCounts[tractId] ??= emptyAgeCounts()
              if (ag in tractAgeCounts[tractId]) tractAgeCounts[tractId][ag as keyof AgeCounts]++
              else tractAgeCounts[tractId].unknown++
            }
          }

          // Compute median helper
          const computeMedian = (arr: number[]): number => {
            const sorted = [...arr].sort((a, b) => a - b)
            const mid = Math.floor(sorted.length / 2)
            return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
          }

          // Update block group features with patron counts + all derived stats
          for (const bgFeat of bgData.features) {
            const geoid = bgFeat.properties?.GEOID
            if (!geoid || !bgAgeCounts[geoid]) continue
            const count = ageCountsTotal(bgAgeCounts[geoid])
            patronCountsByGeoid[geoid] = count
            const pop = Number(bgFeat.properties?.population) || 0
            const total = bgTotalCount[geoid] ?? 0
            const active = bgActiveCount[geoid] ?? 0
            bgFeat.properties = {
              ...bgFeat.properties,
              patron_count: count,
              penetration: pop > 0 ? (count / pop) * 100 : 0,
              median_checkouts: bgCheckouts[geoid]?.length ? computeMedian(bgCheckouts[geoid]) : 0,
              active_rate: total > 0 ? (active / total) * 100 : 0,
              non_circ_rate: active > 0 ? ((bgActiveZeroChk[geoid] ?? 0) / active) * 100 : 0,
              power_user_pct: total > 0 ? ((bgPowerCount[geoid] ?? 0) / total) * 100 : 0,
            }
          }
          bgSrc.setData(bgData as GeoJSON.GeoJSON)

          // Township-level age counts
          const townshipAgeCounts: Record<string, AgeCounts> = {}
          if (haverfordFeat && ageCountsTotal(townshipAges) > 0) {
            const name = haverfordFeat.properties?.NAME ?? "Haverford township"
            townshipAgeCounts[name] = townshipAges
          }

          // --- Generate polygon sub-fills for each level ---
          // Block group fills
          const bgFillFeatures: GeoJSON.Feature[] = []
          for (const bgFeat of bgData.features) {
            const geoid = bgFeat.properties?.GEOID
            if (!geoid || !bgAgeCounts[geoid]) continue
            bgFillFeatures.push(
              ...splitPolygonByAge(
                bgFeat as GeoJSON.Feature<GeoJSON.Polygon>,
                bgAgeCounts[geoid],
                "blockgroup",
                `BG ${bgFeat.properties?.bg} · Tract ${bgFeat.properties?.tract}`,
              ),
            )
          }
          const bgFillSrc = map.getSource("age-fill-blockgroup") as maplibregl.GeoJSONSource
          bgFillSrc.setData({ type: "FeatureCollection", features: bgFillFeatures })

          // Tract fills — clip tracts to Haverford Township
          const tractFillFeatures: GeoJSON.Feature[] = []
          for (const tractFeat of tractData.features) {
            const tractGeoid = tractFeat.properties?.GEOID
            if (!tractGeoid || !tractAgeCounts[tractGeoid]) continue

            // Clip tract to Haverford Township boundary
            let clippedTract = tractFeat as GeoJSON.Feature<GeoJSON.Polygon>
            if (haverfordFeat) {
              try {
                const clipped = intersect(featureCollection([tractFeat as any, haverfordFeat as any]))
                if (!clipped) continue
                clippedTract = clipped as GeoJSON.Feature<GeoJSON.Polygon>
                clippedTract.properties = { ...tractFeat.properties, ...clippedTract.properties }
              } catch {
                continue
              }
            }

            tractFillFeatures.push(
              ...splitPolygonByAge(
                clippedTract,
                tractAgeCounts[tractGeoid],
                "tract",
                tractFeat.properties?.NAME ?? "Census Tract",
              ),
            )
          }
          const tractFillSrc = map.getSource("age-fill-tract") as maplibregl.GeoJSONSource
          tractFillSrc.setData({ type: "FeatureCollection", features: tractFillFeatures })

          // Township fill — just Haverford
          const townshipFillFeatures: GeoJSON.Feature[] = []
          if (haverfordFeat && townshipAgeCounts[haverfordFeat.properties?.NAME ?? ""]) {
            const name = haverfordFeat.properties?.NAME ?? "Haverford township"
            townshipFillFeatures.push(
              ...splitPolygonByAge(
                haverfordFeat as GeoJSON.Feature<GeoJSON.Polygon>,
                townshipAgeCounts[name],
                "township",
                name,
              ),
            )
          }
          const townshipFillSrc = map.getSource("age-fill-township") as maplibregl.GeoJSONSource
          townshipFillSrc.setData({ type: "FeatureCollection", features: townshipFillFeatures })

          // --- Create label markers at centroids ---
          for (const m of ageFillLabels) m.remove()
          ageFillLabels.length = 0

          // Helper to add a label marker
          const addLabel = (feat: GeoJSON.Feature, counts: AgeCounts, label: string, level: string) => {
            const total = ageCountsTotal(counts)
            if (total === 0) return
            const center = centroid(feat as any)
            const coords = center.geometry.coordinates as [number, number]
            const el = document.createElement("div")
            el.className = "age-fill-label"
            el.dataset.pieLevel = level
            el.style.cssText = "background:rgba(255,255,255,0.9);border-radius:4px;padding:2px 6px;font-size:11px;font-weight:700;color:#333;pointer-events:auto;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,0.2);white-space:nowrap;"
            el.textContent = `${total.toLocaleString()}`
            const marker = new maplibregl.Marker({ element: el, anchor: "center" })
              .setLngLat(coords)
              .setPopup(new maplibregl.Popup({ maxWidth: "220px" }).setHTML(piePopupHtml(counts, label)))
            ageFillLabels.push(marker)
          }

          // Block group labels
          for (const bgFeat of bgData.features) {
            const geoid = bgFeat.properties?.GEOID
            if (!geoid || !bgAgeCounts[geoid]) continue
            addLabel(bgFeat, bgAgeCounts[geoid], `Block Group ${bgFeat.properties?.bg} · Tract ${bgFeat.properties?.tract}`, "blockgroup")
          }

          // Tract labels
          for (const tractFeat of tractData.features) {
            const tractGeoid = tractFeat.properties?.GEOID
            if (!tractGeoid || !tractAgeCounts[tractGeoid]) continue
            addLabel(tractFeat, tractAgeCounts[tractGeoid], tractFeat.properties?.NAME ?? "Census Tract", "tract")
          }

          // Township label
          if (haverfordFeat && townshipAgeCounts[haverfordFeat.properties?.NAME ?? ""]) {
            const name = haverfordFeat.properties?.NAME ?? "Haverford township"
            addLabel(haverfordFeat, townshipAgeCounts[name], name, "township")
          }

          updateAgeFillVisibility()
        })
      }

      // Manage age-fill layer and label visibility by zoom level and toggle state
      let pieChartsEnabled = false

      const updateAgeFillVisibility = () => {
        const zoom = map.getZoom()
        // Determine which level is active
        const activeLevel = zoom < 11.5 ? "township" : zoom < 13 ? "tract" : "blockgroup"

        for (const level of AGE_FILL_LEVELS) {
          const vis = pieChartsEnabled && level === activeLevel ? "visible" : "none"
          if (map.getLayer(`age-fill-${level}`)) {
            map.setLayoutProperty(`age-fill-${level}`, "visibility", vis)
          }
          if (map.getLayer(`age-fill-${level}-outline`)) {
            map.setLayoutProperty(`age-fill-${level}-outline`, "visibility", vis)
          }
        }

        // Labels
        for (const marker of ageFillLabels) {
          const el = marker.getElement()
          const level = el.dataset.pieLevel
          const shouldShow = pieChartsEnabled && level === activeLevel
          const onMap = el.parentElement
          if (shouldShow && !onMap) marker.addTo(map)
          else if (!shouldShow && onMap) marker.remove()
        }
      }

      map.on("zoom", updateAgeFillVisibility)

      // Listen for toggle event from controls
      map.on("pie-charts-toggle" as any, ((e: { visible: boolean }) => {
        pieChartsEnabled = e.visible
        updateAgeFillVisibility()
      }) as any)

      const allSourceIds = ["patrons", "blockgroups", "tracts", "townships"]
      const onSourcesReady = () => {
        if (allSourceIds.every((id) => map.isSourceLoaded(id))) {
          computePatronCounts()
          map.off("sourcedata", onSourcesReady)
        }
      }
      map.on("sourcedata", onSourcesReady)

      // Block group click popup
      const bgPopup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        maxWidth: "280px",
      })

      map.on("click", "blockgroup-fill", (e) => {
        if (!e.features?.length) return
        const props = e.features[0].properties
        const geoid = props?.GEOID ?? ""
        const bg = props?.bg ?? "?"
        const tract = props?.tract ?? "?"

        // Highlight selected block group
        map.setFilter("blockgroup-highlight", ["==", ["get", "GEOID"], geoid])

        const pop = props?.population ?? "N/A"
        const fmt = (v: unknown) =>
          v != null ? `$${Number(v).toLocaleString()}` : "N/A"
        const meanInc = fmt(props?.mean_income)
        const medInc = fmt(props?.median_income)
        const pcInc = fmt(props?.per_capita_income)

        const patronCount = patronCountsByGeoid[geoid] ?? 0
        const population = Number(props?.population) || 0
        const penetration =
          population > 0 ? ((patronCount / population) * 100).toFixed(1) : "N/A"

        const activeRate = props?.active_rate != null ? Number(props.active_rate).toFixed(1) : "N/A"
        const medianChk = props?.median_checkouts != null ? Number(props.median_checkouts).toLocaleString() : "N/A"
        const nonCircRate = props?.non_circ_rate != null ? Number(props.non_circ_rate).toFixed(1) : "N/A"
        const powerPct = props?.power_user_pct != null ? Number(props.power_user_pct).toFixed(1) : "N/A"

        const html = `<div style="font-size:12px;line-height:1.5">
              <div style="font-weight:700;font-size:13px;margin-bottom:4px">BG ${bg} &middot; Tract ${tract}</div>
              <div>Population: <strong>${pop}</strong></div>
              <div>Mean HH Income: ${meanInc}</div>
              <div>Median HH Income: ${medInc}</div>
              <div>Per Capita Income: ${pcInc}</div>
              <hr style="margin:6px 0;border-color:#e5e7eb"/>
              <div>Patrons in area: <strong>${patronCount.toLocaleString()}</strong></div>
              <div>Penetration: <strong>${penetration}%</strong></div>
              <div>Active patron rate: <strong>${activeRate}%</strong></div>
              <div>Median checkouts: <strong>${medianChk}</strong></div>
              <div>Non-circ. active: <strong>${nonCircRate}%</strong></div>
              <div>Power users (500+): <strong>${powerPct}%</strong></div>
            </div>`

        bgPopup.setLngLat(e.lngLat).setHTML(html)
        if (!bgPopup.isOpen()) {
          bgPopup.addTo(map)
        }
      })

      bgPopup.on("close", () => {
        map.setFilter("blockgroup-highlight", ["==", ["get", "GEOID"], ""])
      })

      map.on("mouseenter", "blockgroup-fill", () => {
        map.getCanvas().style.cursor = "pointer"
      })
      map.on("mouseleave", "blockgroup-fill", () => {
        map.getCanvas().style.cursor = ""
      })

      // County boundaries
      map.addSource("counties", {
        type: "geojson",
        data: `${import.meta.env.BASE_URL}data/counties.geojson`,
      })

      map.addLayer({
        id: "county-borders",
        type: "line",
        source: "counties",
        filter: ["==", ["get", "GEOID"], "42045"],
        paint: {
          "line-color": COLORS.county,
          "line-width": 2,
        },
      })

      map.addSource("county-label-point", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: DELAWARE_COUNTY_CENTER,
              },
              properties: { NAME: "Delaware County" },
            },
          ],
        },
      })

      // map.addLayer({
      //   id: "county-labels",
      //   type: "symbol",
      //   source: "county-label-point",
      //   maxzoom: 11.5,
      //   layout: {
      //     "text-field": ["get", "NAME"],
      //     "text-size": 14,
      //     "text-font": ["Open Sans Bold"],
      //   },
      //   paint: {
      //     "text-color": COLORS.county,
      //     "text-halo-color": "#ffffff",
      //     "text-halo-width": 2,
      //   },
      // })

      // Census tracts
      map.addSource("tracts", {
        type: "geojson",
        data: `${import.meta.env.BASE_URL}data/tracts.geojson`,
      })

      map.addLayer(
        {
          id: "tract-borders",
          type: "line",
          source: "tracts",
          paint: {
            "line-color": COLORS.tracts,
            "line-width": 1,
            "line-dasharray": [2, 2],
          },
          minzoom: 11.5,
        },
        "county-borders",
      )

      // Township boundaries
      map.addSource("townships", {
        type: "geojson",
        data: `${import.meta.env.BASE_URL}data/townships.geojson`,
      })

      map.addLayer(
        {
          id: "township-borders",
          type: "line",
          source: "townships",
          filter: [
            "all",
            ["==", ["get", "COUNTY"], "045"],
            ["!=", ["get", "NAME"], "Haverford township"],
          ],
          paint: {
            "line-color": COLORS.township,
            "line-width": 1,
          },
        },
        "county-borders",
      )

      map.addLayer({
        id: "haverford-border",
        type: "line",
        source: "townships",
        filter: ["==", ["get", "NAME"], "Haverford township"],
        paint: {
          "line-color": COLORS.haverford,
          "line-width": 2.5,
        },
      })

      // map.addLayer({
      //   id: "township-labels",
      //   type: "symbol",
      //   source: "townships",
      //   filter: ["==", ["get", "COUNTY"], "045"],
      //   layout: {
      //     "text-field": ["get", "NAME"],
      //     "text-size": 11,
      //     "text-font": ["Open Sans Regular"],
      //   },
      //   paint: {
      //     "text-color": COLORS.township,
      //     "text-halo-color": "#ffffff",
      //     "text-halo-width": 1.5,
      //   },
      //   minzoom: 11,
      // })

      setLoading(false)
    })

    // HTFL marker with integrated label
    const markerEl = document.createElement("div")
    markerEl.innerHTML = `
      <svg width="50" height="60" viewBox="0 0 50 60" xmlns="http://www.w3.org/2000/svg">
        <text x="25" y="12" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="12" fill="#EA4335" stroke="#fff" stroke-width="3" paint-order="stroke">HTFL</text>
        <path d="M25 17C18.925 17 14 21.925 14 28c0 10.125 11 22 11 22s11-11.875 11-22c0-6.075-4.925-11-11-11z" fill="#EA4335"/>
        <circle cx="25" cy="28" r="4.5" fill="#B31412"/>
      </svg>
    `
    markerEl.style.cursor = "pointer"

    new maplibregl.Marker({ element: markerEl, anchor: "bottom" })
      .setLngLat(HTFL_COORDS)
      .addTo(map)

    mapRef.current = map
    onMapReady?.(map)

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  return (
    <div className="absolute w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-gray-700" />
            <p className="text-sm text-gray-600">{loadingStatus}</p>
          </div>
        </div>
      )}
    </div>
  )
}
