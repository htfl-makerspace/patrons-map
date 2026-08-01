import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-vite-plugin";
import path from "path";

export default defineConfig({
  base: "/patrons-map/",
  plugins: [
    react(),
    tailwindcss(),
    TanStackRouterVite({
      routesDirectory: "./routes",
      generatedRouteTree: "./routeTree.gen.ts",
    }),
  ],
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "."),
    },
  },
});
