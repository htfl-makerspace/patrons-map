import { useNavigate } from "@tanstack/react-router"
import { supabase } from "~/lib/supabase"
import { Button } from "~/ui/button"

export function AppHeader() {
  const navigate = useNavigate()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate({ to: "/login", replace: true })
  }

  return (
    <div className="relative w-screen flex items-start justify-between z-10 p-3">
      {/* Logo — top left */}
      <div className="relative z-10 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-2">
        <img
          src={`${import.meta.env.BASE_URL}htfl_logo.png`}
          className="max-w-32"
        />
      </div>

      {/* Title — top center */}
      <div className="relative z-10 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-5 text-center">
        <div className="font-semibold text-lg leading-tight">
          A Geographical Distribution of the Library's Patrons
        </div>
        <div className="text-sm text-muted-foreground">2001 – present</div>
      </div>

      {/* Sign out — top right */}
      <div className="relative z-10">
        <Button
          variant="outline"
          size="sm"
          onClick={handleSignOut}
          className="bg-[var(--htfl-indigo)] text-white shadow-lg">
          Sign out
        </Button>
      </div>
    </div>
  )
}
