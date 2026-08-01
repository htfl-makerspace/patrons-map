import {
  createRootRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useAuth } from "~/hooks/useAuth";
import { AppHeader } from "~/components/app-header";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const isLoginPage = pathname === "/login";

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!session && !isLoginPage) {
    navigate({ to: "/login", replace: true });
    return null;
  }

  if (isLoginPage) {
    return <Outlet />;
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <Outlet />
      <AppHeader />
    </div>
  );
}
