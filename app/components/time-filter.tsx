import { useState, useEffect, useCallback, useRef } from "react"
import { Slider } from "~/components/ui/slider"
import { Badge } from "~/components/ui/badge"
import type maplibregl from "maplibre-gl"
import type { GeoJSON } from "geojson"

const MIN_YEAR = 2001
const MAX_YEAR = 2026

interface TimeFilterProps {
  map: maplibregl.Map | null
}

export default function TimeFilter({ map }: TimeFilterProps) {
  const [range, setRange] = useState<[number, number]>([MIN_YEAR, MAX_YEAR])
  const [count, setCount] = useState<number | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const allFeatures = useRef<GeoJSON.Feature[]>([])

  const updateCount = useCallback((start: number, end: number) => {
    if (allFeatures.current.length === 0) return
    if (start === MIN_YEAR && end === MAX_YEAR) {
      setCount(allFeatures.current.length)
    } else {
      const startDate = `${start}-01-01`
      const endDate = `${end}-12-31`
      const n = allFeatures.current.filter((f) => {
        const created = f.properties?.created as string | undefined
        if (!created) return false
        return created >= startDate && created <= endDate
      }).length
      setCount(n)
    }
  }, [])

  const applyFilter = useCallback(
    (start: number, end: number) => {
      if (!map || !map.getLayer("patron-dots")) return

      if (start === MIN_YEAR && end === MAX_YEAR) {
        map.setFilter("patron-dots", null)
      } else {
        map.setFilter("patron-dots", [
          "all",
          [">=", ["get", "created"], `${start}-01-01`],
          ["<=", ["get", "created"], `${end}-12-31`],
        ])
      }

      updateCount(start, end)
    },
    [map, updateCount],
  )

  useEffect(() => {
    applyFilter(range[0], range[1])
  }, [range, applyFilter])

  // Cache all features from the GeoJSON source once loaded
  useEffect(() => {
    if (!map) return

    const onData = () => {
      const source = map.getSource("patrons") as maplibregl.GeoJSONSource | undefined
      if (!source || !map.isSourceLoaded("patrons")) return

      // _data holds the raw GeoJSON (url or object) on GeoJSONSource
      // Once loaded, we can read it via internal _data which is resolved
      // Instead, re-fetch from the same URL the map uses
      source.getData().then((data) => {
        if (data && "features" in data) {
          allFeatures.current = data.features
          setTotal(data.features.length)
          updateCount(range[0], range[1])
        }
        map.off("sourcedata", onData)
      })
    }

    map.on("sourcedata", onData)
    return () => {
      map.off("sourcedata", onData)
    }
  }, [map, updateCount, range])

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg px-6 py-4 w-[420px]">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-700">
          {range[0]} &ndash; {range[1]}
        </span>
        {count !== null && (
          <Badge variant="secondary" className="text-xs">
            {count.toLocaleString()}{total !== null && ` / ${total.toLocaleString()}`} patrons
          </Badge>
        )}
      </div>
      <Slider
        min={MIN_YEAR}
        max={MAX_YEAR}
        step={1}
        value={range}
        onValueChange={(v) => setRange(v as [number, number])}
      />
      <div className="flex justify-between mt-3">
        <span className="text-[10px] text-gray-400">{MIN_YEAR}</span>
        <span className="text-[10px] text-gray-400">{MAX_YEAR}</span>
      </div>
    </div>
  )
}
