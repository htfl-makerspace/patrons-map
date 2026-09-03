import { useMemo } from "react"
import {
  AGE_GROUP_KEYS,
  AGE_GROUP_LABELS,
  AGE_GROUP_COLORS,
  HAVERFORD_CENSUS_AGE,
  HAVERFORD_CENSUS_TOTAL,
} from "./census-age-data"
import type { AgeGroupKey } from "./census-age-data"

interface AgeComparisonChartProps {
  patronFeatures: GeoJSON.Feature[]
}

export default function AgeComparisonChart({ patronFeatures }: AgeComparisonChartProps) {
  const patronCounts = useMemo(() => {
    const counts: Record<AgeGroupKey, number> = {
      "0-9": 0, "10-17": 0, "18-34": 0, "35-64": 0, "65+": 0,
    }
    let total = 0
    for (const f of patronFeatures) {
      const ag = f.properties?.age_group as string
      if (ag && ag in counts) {
        counts[ag as AgeGroupKey]++
        total++
      }
    }
    return { counts, total }
  }, [patronFeatures])

  if (patronCounts.total === 0) return null

  // Compute percentages for both datasets
  const maxPct = Math.max(
    ...AGE_GROUP_KEYS.map((k) =>
      Math.max(
        (HAVERFORD_CENSUS_AGE[k] / HAVERFORD_CENSUS_TOTAL) * 100,
        (patronCounts.counts[k] / patronCounts.total) * 100,
      )
    ),
  )
  // Round up to nearest 5 for nice axis
  const axisCap = Math.ceil(maxPct / 5) * 5

  return (
    <div className="pointer-events-auto bg-white/95 backdrop-blur-sm rounded-lg shadow-lg flex-shrink-0">
      <div className="px-4 py-2.5 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">
          Age Distribution
        </span>
      </div>
      <div className="px-4 py-3 space-y-1">
        {/* Legend */}
        <div className="flex gap-4 mb-2 text-[10px] text-gray-500">
          <div className="flex items-center gap-1">
            <span className="inline-block w-3 h-1.5 rounded-sm bg-gray-400 opacity-50" />
            Township census
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block w-3 h-1.5 rounded-sm bg-indigo-500" />
            Library patrons
          </div>
        </div>

        {AGE_GROUP_KEYS.map((key) => {
          const censusPct = (HAVERFORD_CENSUS_AGE[key] / HAVERFORD_CENSUS_TOTAL) * 100
          const patronPct = patronCounts.total > 0
            ? (patronCounts.counts[key] / patronCounts.total) * 100
            : 0

          return (
            <div key={key} className="space-y-0.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: AGE_GROUP_COLORS[key] }}
                  />
                  <span className="text-[11px] font-medium text-gray-600 w-10">
                    {AGE_GROUP_LABELS[key]}
                  </span>
                </div>
                <span className="text-[10px] text-gray-400 tabular-nums">
                  {patronPct.toFixed(1)}% / {censusPct.toFixed(1)}%
                </span>
              </div>
              {/* Stacked bars */}
              <div className="space-y-px">
                <div className="h-[5px] bg-gray-100 rounded-sm overflow-hidden">
                  <div
                    className="h-full rounded-sm opacity-40"
                    style={{
                      width: `${(censusPct / axisCap) * 100}%`,
                      backgroundColor: AGE_GROUP_COLORS[key],
                    }}
                  />
                </div>
                <div className="h-[5px] bg-gray-100 rounded-sm overflow-hidden">
                  <div
                    className="h-full rounded-sm"
                    style={{
                      width: `${(patronPct / axisCap) * 100}%`,
                      backgroundColor: AGE_GROUP_COLORS[key],
                    }}
                  />
                </div>
              </div>
            </div>
          )
        })}

        {/* Totals */}
        <div className="pt-1.5 border-t border-gray-100 flex justify-between text-[10px] text-gray-400">
          <span>Patrons: {patronCounts.total.toLocaleString()}</span>
          <span>Census: {HAVERFORD_CENSUS_TOTAL.toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}
