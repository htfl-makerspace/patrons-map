import { useState } from "react"
import type maplibregl from "maplibre-gl"
import { CHOROPLETH_METRICS, buildFillColorExpression, getChoroplethMetric } from "./choropleth-config"
import { AGE_GROUP_KEYS, AGE_GROUP_LABELS, AGE_GROUP_COLORS } from "./census-age-data"

const CHOROPLETH_LAYER_IDS = ["blockgroup-fill", "blockgroup-borders", "blockgroup-highlight"]

const UNIFORM_DOT_COLOR = "#f00068"

const AGE_GROUP_PAINT_EXPR: maplibregl.ExpressionSpecification = [
  "match", ["get", "age_group"],
  ...AGE_GROUP_KEYS.flatMap((k) => [k, AGE_GROUP_COLORS[k]]),
  "#d1d5db", // fallback for unknown
]

// Split choropleth metrics into census vs patron categories
const CENSUS_METRICS = CHOROPLETH_METRICS.filter(
  (m) => m.id !== "penetration",
)
const PATRON_CHOROPLETH = CHOROPLETH_METRICS.find(
  (m) => m.id === "penetration",
)

interface MapControlsProps {
  map: maplibregl.Map | null
  layerVisibility: Record<string, boolean>
  onLayerVisibilityChange: (vis: Record<string, boolean>) => void
  choroplethMetric: string
  onChoroplethMetricChange: (metric: string) => void
  dotColorMode: "uniform" | "age_group"
  onDotColorModeChange: (mode: "uniform" | "age_group") => void
}

export { UNIFORM_DOT_COLOR }

export default function MapControls({
  map,
  layerVisibility,
  onLayerVisibilityChange,
  choroplethMetric,
  onChoroplethMetricChange,
  dotColorMode,
  onDotColorModeChange,
}: MapControlsProps) {
  const [collapsed, setCollapsed] = useState(false)

  const toggleLayer = (id: string, layerIds: string[]) => {
    if (!map) return
    const newVal = !layerVisibility[id]
    const newVis = { ...layerVisibility, [id]: newVal }
    onLayerVisibilityChange(newVis)

    if (id === "pie-charts") {
      map.fire("pie-charts-toggle" as any, { visible: newVal })
      return
    }

    const vis = newVal ? "visible" : "none"
    for (const layerId of layerIds) {
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

    if (map.getLayer("blockgroup-fill")) {
      map.setPaintProperty("blockgroup-fill", "fill-color", buildFillColorExpression(metric))
    }

    for (const layerId of CHOROPLETH_LAYER_IDS) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", "visible")
      }
    }
  }

  const selectDotColor = (mode: "uniform" | "age_group") => {
    if (!map) return
    onDotColorModeChange(mode)
    if (map.getLayer("patron-dots")) {
      map.setPaintProperty(
        "patron-dots",
        "circle-color",
        mode === "age_group" ? AGE_GROUP_PAINT_EXPR : UNIFORM_DOT_COLOR,
      )
    }
  }

  const dotsVisible = layerVisibility.dots

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
    <div className="pointer-events-auto bg-white/95 backdrop-blur-sm rounded-lg shadow-lg w-[220px] max-h-[calc(100vh-120px)] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">Visualization</span>
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

      {/* General layers */}
      <div className="px-4 py-2 space-y-1">
        <Checkbox
          checked={layerVisibility["township-borders"]}
          onChange={() => toggleLayer("township-borders", ["township-borders", "haverford-border"])}
          label="Township borders"
        />
      </div>

      {/* ── Census Data ── */}
      <div className="px-4 py-2 border-t border-gray-100 space-y-1">
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide pb-0.5">
          Census Data
        </div>
        <Radio
          name="censusMetric"
          checked={!CENSUS_METRICS.some((m) => m.id === choroplethMetric)}
          onChange={() => selectMetric("none")}
          label="None"
        />
        {CENSUS_METRICS.map((metric) => (
          <Radio
            key={metric.id}
            name="censusMetric"
            checked={choroplethMetric === metric.id}
            onChange={() => selectMetric(metric.id)}
            label={metric.label}
          />
        ))}
      </div>

      {/* ── Patron Data ── */}
      <div className="px-4 py-2 border-t border-gray-100 space-y-1">
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide pb-0.5">
          Patron Data
        </div>

        {/* Patron dots toggle */}
        <Checkbox
          checked={dotsVisible}
          onChange={() => toggleLayer("dots", ["patron-dots"])}
          label="Patron dots"
        />

        {/* Dot coloring — only when dots are visible */}
        {dotsVisible && (
          <div className="pl-6 space-y-1 pb-0.5">
            <Radio
              name="dotColor"
              checked={dotColorMode === "uniform"}
              onChange={() => selectDotColor("uniform")}
            >
              <span className="flex items-center gap-1.5 text-sm text-gray-600">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: UNIFORM_DOT_COLOR, opacity: 0.6 }} />
                Uniform
              </span>
            </Radio>
            <Radio
              name="dotColor"
              checked={dotColorMode === "age_group"}
              onChange={() => selectDotColor("age_group")}
              label="By age group"
            />
            {dotColorMode === "age_group" && (
              <div className="pl-6 space-y-0.5 pb-0.5">
                {AGE_GROUP_KEYS.map((key) => (
                  <div key={key} className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: AGE_GROUP_COLORS[key], opacity: 0.6 }} />
                    <span className="text-xs text-gray-500">{AGE_GROUP_LABELS[key]}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Penetration choropleth */}
        {PATRON_CHOROPLETH && (
          <Checkbox
            checked={choroplethMetric === "penetration"}
            onChange={() => selectMetric(choroplethMetric === "penetration" ? "none" : "penetration")}
            label={PATRON_CHOROPLETH.label}
          />
        )}

        {/* Age distribution fill */}
        <Checkbox
          checked={layerVisibility["pie-charts"]}
          onChange={() => toggleLayer("pie-charts", [])}
          label="Age distribution fill"
        />
      </div>
    </div>
  )
}

/* ── Tiny reusable control components ── */

function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex items-center gap-2 py-1 cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
      />
      <span className="text-sm text-gray-600">{label}</span>
    </label>
  )
}

function Radio({
  name, checked, onChange, label, children,
}: {
  name: string; checked: boolean; onChange: () => void; label?: string; children?: React.ReactNode
}) {
  return (
    <label className="flex items-center gap-2 py-1 cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="border-gray-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
      />
      {children ?? <span className="text-sm text-gray-600">{label}</span>}
    </label>
  )
}
