import { useState, useMemo } from "react"
import { getChoroplethMetric } from "./choropleth-config"
import { UNIFORM_DOT_COLOR } from "./map-controls"
import { AGE_GROUP_KEYS, AGE_GROUP_LABELS, AGE_GROUP_COLORS } from "./census-age-data"

interface InfoPanelProps {
  patronFeatures: GeoJSON.Feature[]
  layerVisibility: Record<string, boolean>
  choroplethMetric: string
  dotColorMode: "uniform" | "age_group"
}

const TOTAL_PATRON_ENTRIES = 21041

const CONFIDENCE_GROUPS: { label: string; levels: string[]; color: string }[] = [
  { label: "High", levels: ["exact", "high"], color: "#16a34a" },
  { label: "Medium", levels: ["medium"], color: "#ca8a04" },
  { label: "Low", levels: ["low"], color: "#dc2626" },
]

function Legend({
  layerVisibility,
  choroplethMetric,
  dotColorMode,
}: {
  layerVisibility: Record<string, boolean>
  choroplethMetric: string
  dotColorMode: "uniform" | "age_group"
}) {
  const hasAny =
    layerVisibility.dots ||
    layerVisibility.choropleth ||
    layerVisibility["township-borders"]

  if (!hasAny) return null

  return (
    <div className="px-4 py-3 space-y-2.5 border-b border-gray-100">
      <h3 className="font-semibold text-gray-800 text-[11px] uppercase tracking-wide">
        Legend
      </h3>

      {/* Patron dots */}
      {layerVisibility.dots && dotColorMode === "uniform" && (
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: UNIFORM_DOT_COLOR, opacity: 0.6 }}
          />
          <span className="text-xs text-gray-600">Library patron</span>
        </div>
      )}
      {layerVisibility.dots && dotColorMode === "age_group" && (
        <div className="space-y-1">
          {AGE_GROUP_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-2">
              <span
                className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: AGE_GROUP_COLORS[key], opacity: 0.6 }}
              />
              <span className="text-xs text-gray-600">{AGE_GROUP_LABELS[key]}</span>
            </div>
          ))}
        </div>
      )}

      {/* Choropleth gradient */}
      {layerVisibility.choropleth && (() => {
        const metric = getChoroplethMetric(choroplethMetric)
        if (!metric) return null
        return (
          <div>
            <div className="text-xs text-gray-600 mb-1">{metric.label}</div>
            <div
              className="h-3 rounded-sm"
              style={{
                background: `linear-gradient(to right, ${metric.stops.map((s) => s.color).join(", ")})`,
              }}
            />
            <div className="flex justify-between mt-0.5">
              <span className="text-[10px] text-gray-400">{metric.legendMin}</span>
              <span className="text-[10px] text-gray-400">{metric.legendMax}</span>
            </div>
          </div>
        )
      })()}

      {/* Line legends */}
      {layerVisibility["township-borders"] && (
        <>
          <div className="flex items-center gap-2">
            <span
              className="inline-block w-5 flex-shrink-0"
              style={{
                height: 2.5,
                backgroundColor: "#615ed6",
                borderRadius: 1,
              }}
            />
            <span className="text-xs text-gray-600">Haverford Township</span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block w-5 flex-shrink-0"
              style={{ height: 1, backgroundColor: "#94a3b8" }}
            />
            <span className="text-xs text-gray-600">Township border</span>
          </div>
        </>
      )}

      {/* Census tract & block group borders — auto-visible by zoom */}
      <div className="flex items-center gap-2">
        <span
          className="inline-block w-5 flex-shrink-0"
          style={{ height: 0, borderTop: "1px dashed #fbbf24" }}
        />
        <span className="text-xs text-gray-600">Census tract (z≥11.5)</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className="inline-block w-5 flex-shrink-0"
          style={{ height: 0, borderTop: "1px solid #999" }}
        />
        <span className="text-xs text-gray-600">Block group (z≥13)</span>
      </div>

      {/* County border — always visible */}
      <div className="flex items-center gap-2">
        <span
          className="inline-block w-5 flex-shrink-0"
          style={{ height: 2, backgroundColor: "#90a500", borderRadius: 1 }}
        />
        <span className="text-xs text-gray-600">Delaware County</span>
      </div>
    </div>
  )
}

const WORD_LIMIT = 30

function DataSources({
  confidenceStats,
  expanded,
  onToggle,
}: {
  confidenceStats: { counts: Record<string, number>; total: number } | null
  expanded: boolean
  onToggle: () => void
}) {
  const fullText = useDataSourcesText(confidenceStats)

  if (!expanded) {
    const words = fullText.split(/\s+/)
    const truncated = words.length > WORD_LIMIT
    const preview = truncated ? words.slice(0, WORD_LIMIT).join(" ") : fullText

    return (
      <p className="leading-relaxed">
        <span className="font-semibold text-gray-800 text-[11px] uppercase tracking-wide">
          Data Sources
        </span>
        {" — "}
        {preview}
        {truncated && (
          <>
            {"… "}
            <button
              onClick={onToggle}
              className="text-indigo-600 hover:text-indigo-800 hover:underline">
              more
            </button>
          </>
        )}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-gray-800 text-[11px] uppercase tracking-wide">
        Data Sources
      </h3>

      <section>
        <p className="font-medium text-gray-700">Patron Data</p>
        <p>Source: Haverford Township Free Library ILS</p>
        {confidenceStats && (
          <>
            <p>
              Conversion rate: {confidenceStats.total.toLocaleString()} / {TOTAL_PATRON_ENTRIES.toLocaleString()} geocoded ({((confidenceStats.total / TOTAL_PATRON_ENTRIES) * 100).toFixed(1)}%)
            </p>
            <p>Geocoder: Mapbox Geocoding v6</p>
            <p className="mt-1 font-medium text-gray-700">Confidence:</p>
            <ul className="ml-2 space-y-0.5">
              {CONFIDENCE_GROUPS.map((group) => {
                const count = group.levels.reduce(
                  (sum, l) => sum + (confidenceStats.counts[l] ?? 0),
                  0,
                )
                if (count === 0) return null
                return (
                  <li key={group.label} className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: group.color }}
                    />
                    {group.label}: {count.toLocaleString()} ({((count / confidenceStats.total) * 100).toFixed(1)}%)
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>

      <section>
        <p className="font-medium text-gray-700">Census Data</p>
        <p>Source: ACS 5-Year Estimates, block group level.</p>
        <p>Coverage: 24 tracts, 74 block groups.</p>
        <p>Variables:</p>
        <ul className="ml-2 space-y-0.5">
          <li>B01003: Total population (2022)</li>
          <li>B19025/B11001: Mean household income (2022)</li>
          <li>B19013: Median household income (2022)</li>
          <li>B19301: Per capita income (2022)</li>
          <li>B01001: Sex by age, township level (2024)</li>
        </ul>
      </section>

      <section>
        <p className="font-medium text-gray-700">Boundaries</p>
        <p>Source: U.S. Census TIGER/Line, vintage 2022.</p>
      </section>

      <div className="text-[10px] text-gray-400">Map tiles: MapTiler</div>

      <button
        onClick={onToggle}
        className="text-indigo-600 hover:text-indigo-800 hover:underline">
        less
      </button>
    </div>
  )
}

function useDataSourcesText(
  confidenceStats: { counts: Record<string, number>; total: number } | null,
) {
  return useMemo(() => {
    const parts: string[] = []
    parts.push("Patron Data: Haverford Township Free Library ILS.")
    if (confidenceStats) {
      const rate = ((confidenceStats.total / TOTAL_PATRON_ENTRIES) * 100).toFixed(1)
      parts.push(
        `Conversion: ${confidenceStats.total.toLocaleString()} / ${TOTAL_PATRON_ENTRIES.toLocaleString()} (${rate}%), geocoded via Mapbox v6.`,
      )
    }
    parts.push(
      "Census Data: ACS 5-Year Estimates (2022), block group level. Variables: population, mean HH income, median HH income, per capita income. Coverage: 24 tracts, 74 block groups.",
    )
    parts.push(
      "Boundaries: U.S. Census TIGER/Line, vintage 2022. Map tiles: MapTiler.",
    )
    return parts.join(" ")
  }, [confidenceStats])
}

export default function InfoPanel({
  patronFeatures,
  layerVisibility,
  choroplethMetric,
  dotColorMode,
}: InfoPanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [sourcesExpanded, setSourcesExpanded] = useState(false)

  const confidenceStats = useMemo(() => {
    if (!patronFeatures.length) return null
    const counts: Record<string, number> = {}
    for (const f of patronFeatures) {
      const conf = f.properties?.geocode_confidence as string | null
      if (!conf) continue
      counts[conf] = (counts[conf] ?? 0) + 1
    }
    const total = patronFeatures.length
    return { counts, total }
  }, [patronFeatures])

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="flex-shrink-0 pointer-events-auto self-start bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-2 hover:bg-gray-50"
        title="Show legend &amp; data sources">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      </button>
    )
  }

  return (
    <div
      className={`flex-shrink-1 min-h-0 pointer-events-auto bg-white/95 backdrop-blur-sm rounded-lg shadow-lg flex flex-col ${sourcesExpanded ? "overflow-y-auto" : "overflow-hidden"}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 flex-shrink-0">
        <span className="text-sm font-semibold text-gray-700">Map Info</span>
        <button
          onClick={() => setCollapsed(true)}
          className="text-gray-400 hover:text-gray-600"
          title="Collapse">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      {/* Legend — always fully visible */}
      <Legend layerVisibility={layerVisibility} choroplethMetric={choroplethMetric} dotColorMode={dotColorMode} />

      {/* Data Sources — inline text, truncated with "more" / "less" */}
      <div
        className={`flex-shrink min-h-0 ${sourcesExpanded ? "overflow-y-auto" : ""}`}>
        <div className="px-4 py-3 text-xs text-gray-600">
          <DataSources
            confidenceStats={confidenceStats}
            expanded={sourcesExpanded}
            onToggle={() => setSourcesExpanded(!sourcesExpanded)}
          />
        </div>
      </div>
    </div>
  )
}
