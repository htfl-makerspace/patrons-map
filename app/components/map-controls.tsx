import { useState } from "react"
import type maplibregl from "maplibre-gl"
import { CHOROPLETH_METRICS, buildFillColorExpression, getChoroplethMetric } from "./choropleth-config"

interface LayerToggle {
  id: string
  label: string
  layerIds: string[]
}

const LAYERS: LayerToggle[] = [
  {
    id: "dots",
    label: "Patron dots",
    layerIds: ["patron-dots"],
  },
  {
    id: "tract-borders",
    label: "Census tract borders",
    layerIds: ["tract-borders"],
  },
  {
    id: "township-borders",
    label: "Township borders",
    layerIds: ["township-borders"],
  },
]

const CHOROPLETH_LAYER_IDS = ["blockgroup-fill", "blockgroup-borders", "blockgroup-highlight"]

interface MapControlsProps {
  map: maplibregl.Map | null
  layerVisibility: Record<string, boolean>
  onLayerVisibilityChange: (vis: Record<string, boolean>) => void
  choroplethMetric: string
  onChoroplethMetricChange: (metric: string) => void
}

export default function MapControls({
  map,
  layerVisibility,
  onLayerVisibilityChange,
  choroplethMetric,
  onChoroplethMetricChange,
}: MapControlsProps) {
  const [collapsed, setCollapsed] = useState(false)

  const toggle = (layer: LayerToggle) => {
    if (!map) return
    const newVal = !layerVisibility[layer.id]
    const newVis = { ...layerVisibility, [layer.id]: newVal }
    onLayerVisibilityChange(newVis)

    const vis = newVal ? "visible" : "none"
    for (const layerId of layer.layerIds) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", vis)
      }
    }
  }

  const selectMetric = (metricId: string) => {
    if (!map) return
    onChoroplethMetricChange(metricId)

    if (metricId === "none") {
      for (const layerId of CHOROPLETH_LAYER_IDS) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, "visibility", "none")
        }
      }
      return
    }

    const metric = getChoroplethMetric(metricId)
    if (!metric) return

    // Update fill color expression
    if (map.getLayer("blockgroup-fill")) {
      map.setPaintProperty("blockgroup-fill", "fill-color", buildFillColorExpression(metric))
    }

    // Show layers
    for (const layerId of CHOROPLETH_LAYER_IDS) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", "visible")
      }
    }
  }

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="pointer-events-auto bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-2 hover:bg-gray-50"
        title="Show layers"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      </button>
    )
  }

  return (
    <div className="pointer-events-auto bg-white/95 backdrop-blur-sm rounded-lg shadow-lg w-[220px]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">Layers</span>
        <button
          onClick={() => setCollapsed(true)}
          className="text-gray-400 hover:text-gray-600"
          title="Collapse"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
      <div className="px-4 py-2 space-y-1">
        {LAYERS.map((layer) => (
          <label
            key={layer.id}
            className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1"
          >
            <input
              type="checkbox"
              checked={layerVisibility[layer.id]}
              onChange={() => toggle(layer)}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
            />
            <span className="text-sm text-gray-600">{layer.label}</span>
          </label>
        ))}
      </div>

      {/* Choropleth metric radio group */}
      <div className="px-4 py-2 border-t border-gray-100 space-y-1">
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide pb-0.5">
          Choropleth
        </div>
        <label className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1">
          <input
            type="radio"
            name="choropleth"
            checked={choroplethMetric === "none"}
            onChange={() => selectMetric("none")}
            className="border-gray-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
          />
          <span className="text-sm text-gray-600">None</span>
        </label>
        {CHOROPLETH_METRICS.map((metric) => (
          <label
            key={metric.id}
            className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1"
          >
            <input
              type="radio"
              name="choropleth"
              checked={choroplethMetric === metric.id}
              onChange={() => selectMetric(metric.id)}
              className="border-gray-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
            />
            <span className="text-sm text-gray-600">{metric.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
