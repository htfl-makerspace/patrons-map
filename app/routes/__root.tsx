import {
  createRootRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router"
import { useAuth } from "~/hooks/useAuth"
import { needsPasswordSetup } from "~/lib/supabase"

export const Route = createRootRoute({
  component: RootComponent,
})

// Pages reachable without a session
const PUBLIC_PATHS = ["/login", "/forgot-password"]
// Pages rendered full-screen on the auth background instead of the map shell
const AUTH_PATHS = [...PUBLIC_PATHS, "/set-password"]

function RootComponent() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (!session && !PUBLIC_PATHS.includes(pathname)) {
    navigate({ to: "/login", replace: true })
    return null
  }

  // Invite / password-reset links sign the user in; make them pick a password
  // before they get to the map.
  if (session && needsPasswordSetup() && pathname !== "/set-password") {
    navigate({ to: "/set-password", replace: true })
    return null
  }

  if (AUTH_PATHS.includes(pathname)) {
    return <Outlet />
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden flex">
      <Outlet />
    </div>
  )
}
