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
    id: "active_rate",
    label: "Active patron rate",
    property: "active_rate",
    stops: [
      { value: 30, color: "#d73027" },
      { value: 40, color: "#f46d43" },
      { value: 50, color: "#fdae61" },
      { value: 55, color: "#fee08b" },
      { value: 60, color: "#d9ef8b" },
      { value: 65, color: "#a6d96a" },
      { value: 70, color: "#66bd63" },
      { value: 75, color: "#1a9850" },
    ],
    legendMin: "30%",
    legendMax: "75%+",
  },
  {
    id: "median_checkouts",
    label: "Median checkouts",
    property: "median_checkouts",
    stops: [
      { value: 0, color: "#f7fcf5" },
      { value: 3, color: "#c7e9c0" },
      { value: 8, color: "#74c476" },
      { value: 15, color: "#31a354" },
      { value: 25, color: "#006d2c" },
    ],
    legendMin: "0",
    legendMax: "25+",
  },
  {
    id: "non_circ_rate",
    label: "Non-circ. active users",
    property: "non_circ_rate",
    stops: [
      { value: 5, color: "#eff3ff" },
      { value: 10, color: "#bdd7e7" },
      { value: 15, color: "#6baed6" },
      { value: 20, color: "#3182bd" },
      { value: 30, color: "#08519c" },
    ],
    legendMin: "5%",
    legendMax: "30%+",
  },
  {
    id: "power_user_pct",
    label: "Power users (500+)",
    property: "power_user_pct",
    stops: [
      { value: 0, color: "#fff7ec" },
      { value: 3, color: "#fee8c8" },
      { value: 5, color: "#fdbb84" },
      { value: 7, color: "#fc8d59" },
      { value: 9, color: "#e34a33" },
      { value: 12, color: "#b30000" },
    ],
    legendMin: "0%",
    legendMax: "12%+",
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
