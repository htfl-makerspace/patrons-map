import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AppHeader } from "~/components/app-header";

export const Route = createRootRoute({
  component: () => (
    <div className="relative h-screen w-screen overflow-hidden">
      <Outlet />
      <AppHeader />
    </div>
  ),
});
