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
    <header className="absolute top-0 left-0 right-0 z-10 flex items-center p-5 bg-white">
      <img src="/htfl_logo.png" className="max-w-40 absolute top-2 left-2" />
      <div className="flex-1 text-center">
        <div className="font-semibold text-xl">
          A Geographical Distribution of the Library's Patrons
        </div>
        <div className="text-base text-muted-foreground">2001 – present</div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={handleSignOut}
        className="bg-[var(--htfl-indigo)] text-white">
        Sign out
      </Button>
    </header>
  )
}
