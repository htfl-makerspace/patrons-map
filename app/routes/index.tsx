import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type maplibregl from "maplibre-gl";
import Map from "~/components/map";
import TimeFilter from "~/components/time-filter";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const [map, setMap] = useState<maplibregl.Map | null>(null);

  return (
    <div className="absolute inset-0">
      <Map onMapReady={setMap} />
      <TimeFilter map={map} />
    </div>
  );
}
