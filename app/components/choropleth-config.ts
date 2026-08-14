export interface ChoroplethStop {
  value: number
  color: string
}

export interface ChoroplethMetricConfig {
  id: string
  label: string
  property: string
  stops: ChoroplethStop[]
  legendMin: string
  legendMax: string
}

export const CHOROPLETH_METRICS: ChoroplethMetricConfig[] = [
  {
    id: "penetration",
    label: "Penetration rate",
    property: "penetration",
    stops: [
      { value: 0, color: "#d73027" },
      { value: 10, color: "#f46d43" },
      { value: 20, color: "#fdae61" },
      { value: 30, color: "#fee08b" },
      { value: 40, color: "#d9ef8b" },
      { value: 50, color: "#a6d96a" },
      { value: 60, color: "#66bd63" },
      { value: 70, color: "#1a9850" },
    ],
    legendMin: "0%",
    legendMax: "70%+",
  },
  {
    id: "mean_income",
    label: "Mean HH income",
    property: "mean_income",
    stops: [
      { value: 50000, color: "#d73027" },
      { value: 100000, color: "#f46d43" },
      { value: 150000, color: "#fdae61" },
      { value: 200000, color: "#fee08b" },
      { value: 250000, color: "#d9ef8b" },
      { value: 300000, color: "#a6d96a" },
      { value: 400000, color: "#66bd63" },
      { value: 500000, color: "#1a9850" },
    ],
    legendMin: "$50k",
    legendMax: "$500k+",
  },
  {
    id: "median_income",
    label: "Median HH income",
    property: "median_income",
    stops: [
      { value: 50000, color: "#d73027" },
      { value: 75000, color: "#f46d43" },
      { value: 100000, color: "#fdae61" },
      { value: 125000, color: "#fee08b" },
      { value: 150000, color: "#d9ef8b" },
      { value: 175000, color: "#a6d96a" },
      { value: 200000, color: "#66bd63" },
      { value: 250000, color: "#1a9850" },
    ],
    legendMin: "$50k",
    legendMax: "$250k+",
  },
  {
    id: "per_capita_income",
    label: "Per capita income",
    property: "per_capita_income",
    stops: [
      { value: 25000, color: "#d73027" },
      { value: 35000, color: "#f46d43" },
      { value: 45000, color: "#fdae61" },
      { value: 55000, color: "#fee08b" },
      { value: 65000, color: "#d9ef8b" },
      { value: 75000, color: "#a6d96a" },
      { value: 85000, color: "#66bd63" },
      { value: 100000, color: "#1a9850" },
    ],
    legendMin: "$25k",
    legendMax: "$100k+",
  },
]

export function getChoroplethMetric(id: string): ChoroplethMetricConfig | undefined {
  return CHOROPLETH_METRICS.find((m) => m.id === id)
}

export function buildFillColorExpression(metric: ChoroplethMetricConfig): unknown[] {
  const expr: unknown[] = ["interpolate", ["linear"], ["get", metric.property]]
  for (const stop of metric.stops) {
    expr.push(stop.value, stop.color)
  }
  return expr
}
