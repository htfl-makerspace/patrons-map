import { createFileRoute } from "@tanstack/react-router"
import { useState, useEffect, useCallback } from "react"
import type maplibregl from "maplibre-gl"
import Map from "~/components/map"
import TimeFilter from "~/components/time-filter"
import MapControls from "~/components/map-controls"
import InfoPanel from "~/components/info-panel"
import { AppHeader } from "~/components/app-header"

export const Route = createFileRoute("/")({
  component: Home,
})

function Home() {
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const [patronFeatures, setPatronFeatures] = useState<GeoJSON.Feature[]>([])
  const [choroplethMetric, setChoroplethMetric] = useState("none")
  const [dotColorMode, setDotColorMode] = useState<"uniform" | "age_group">("uniform")
  const [layerVisibility, setLayerVisibility] = useState<
    Record<string, boolean>
  >({
    dots: true,
    "tract-borders": true,
    "township-borders": true,
  })

  // Cache patron features from the map source for the info panel
  useEffect(() => {
    if (!map) return

    const onData = () => {
      const source = map.getSource("patrons") as
        maplibregl.GeoJSONSource | undefined
      if (!source || !map.isSourceLoaded("patrons")) return

      source.getData().then((data) => {
        if (data && "features" in data) {
          setPatronFeatures(data.features)
          map.off("sourcedata", onData)
        }
      })
    }

    map.on("sourcedata", onData)
    return () => {
      map.off("sourcedata", onData)
    }
  }, [map])

  const handleLayerChange = useCallback((newVis: Record<string, boolean>) => {
    setLayerVisibility(newVis)
  }, [])

  return (
    <div className="w-screen h-screen flex flex-col">
      {/* Absolute: always full screen behind everything */}
      <Map onMapReady={setMap} />

      <AppHeader />

      {/* Map controls row — fills remaining height, left & right sidebars */}
      <div className="flex-1 min-h-0 z-10 flex justify-between p-3 pt-0 pointer-events-none">
        {/* Left side: info panel + time slider */}
        <div className="flex flex-col gap-3 w-[320px]">
          <InfoPanel
            patronFeatures={patronFeatures}
            layerVisibility={{ ...layerVisibility, choropleth: choroplethMetric !== "none" }}
            choroplethMetric={choroplethMetric}
            dotColorMode={dotColorMode}
          />
          <TimeFilter map={map} disabled={!layerVisibility.dots} />
        </div>

        {/* Right side: layer controls */}
        <div className="flex flex-col items-end justify-center">
          <MapControls
            map={map}
            layerVisibility={layerVisibility}
            onLayerVisibilityChange={handleLayerChange}
            choroplethMetric={choroplethMetric}
            onChoroplethMetricChange={setChoroplethMetric}
            dotColorMode={dotColorMode}
            onDotColorModeChange={setDotColorMode}
          />
        </div>
      </div>
    </div>
  )
}
