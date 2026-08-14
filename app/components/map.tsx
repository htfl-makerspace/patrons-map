import { useRef, useEffect, useState } from "react"
import maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { supabase } from "~/lib/supabase"
import booleanPointInPolygon from "@turf/boolean-point-in-polygon"

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

      // Pre-compute patron counts per block group once both sources load
      const patronCountsByGeoid: Record<string, number> = {}

      const computePatronCounts = () => {
        const patronSrc = map.getSource("patrons") as
          maplibregl.GeoJSONSource | undefined
        const bgSrc = map.getSource("blockgroups") as
          maplibregl.GeoJSONSource | undefined
        if (!patronSrc || !bgSrc) return

        Promise.all([patronSrc.getData(), bgSrc.getData()]).then(
          ([patronData, bgData]) => {
            if (!patronData || !("features" in patronData)) return
            if (!bgData || !("features" in bgData)) return

            // Count patrons per block group
            for (const bgFeat of bgData.features) {
              const geoid = bgFeat.properties?.GEOID
              if (!geoid) continue
              let count = 0
              for (const pFeat of patronData.features) {
                const coords = (pFeat.geometry as GeoJSON.Point).coordinates
                if (
                  booleanPointInPolygon(
                    coords as [number, number],
                    bgFeat as any,
                  )
                ) {
                  count++
                }
              }
              patronCountsByGeoid[geoid] = count
              const pop = Number(bgFeat.properties?.population) || 0
              bgFeat.properties = {
                ...bgFeat.properties,
                patron_count: count,
                penetration: pop > 0 ? (count / pop) * 100 : 0,
              }
            }

            // Update source so the choropleth reflects penetration rates
            bgSrc.setData(bgData as GeoJSON.GeoJSON)
          },
        )
      }

      const onSourcesReady = () => {
        if (
          map.isSourceLoaded("patrons") &&
          map.isSourceLoaded("blockgroups")
        ) {
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

        const html = `<div style="font-size:12px;line-height:1.5">
              <div style="font-weight:700;font-size:13px;margin-bottom:4px">BG ${bg} &middot; Tract ${tract}</div>
              <div>Population: <strong>${pop}</strong></div>
              <div>Mean HH Income: ${meanInc}</div>
              <div>Median HH Income: ${medInc}</div>
              <div>Per Capita Income: ${pcInc}</div>
              <hr style="margin:6px 0;border-color:#e5e7eb"/>
              <div>Patrons in area: <strong>${patronCount.toLocaleString()}</strong></div>
              <div>Penetration: <strong>${penetration}%</strong></div>
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
          minzoom: 12,
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
