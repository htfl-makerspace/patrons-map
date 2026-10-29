import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { clearPasswordSetup, supabase } from "~/lib/supabase"
import { useAuth } from "~/hooks/useAuth"
import { Button } from "~/ui/button"
import { AuthLayout, authInputClass } from "~/components/auth-layout"

const MIN_LENGTH = 8

export const Route = createFileRoute("/set-password")({
  component: SetPasswordPage,
})

/**
 * Reached after accepting an invite or a password-reset link sent from the
 * Supabase dashboard (both sign the user in), or directly by a signed-in user
 * changing their password.
 */
function SetPasswordPage() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError("")

    if (password.length < MIN_LENGTH) {
      setError(`Password must be at least ${MIN_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError("Passwords don't match.")
      return
    }

    setSubmitting(true)
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError(error.message)
      setSubmitting(false)
    } else {
      clearPasswordSetup()
      navigate({ to: "/", replace: true })
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate({ to: "/login", replace: true })
  }

  return (
    <AuthLayout title="Set your password">
      <form onSubmit={handleSubmit} className="grid gap-4">
        {session?.user.email && (
          <p className="text-sm text-muted-foreground">
            Signed in as <strong>{session.user.email}</strong>. Choose a
            password to use next time you sign in.
          </p>
        )}
        <div className="grid gap-2">
          <label htmlFor="password" className="text-sm font-medium">
            New password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputClass}
          />
        </div>
        <div className="grid gap-2">
          <label htmlFor="confirm" className="text-sm font-medium">
            Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={authInputClass}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Save password"}
        </Button>
        <button
          type="button"
          onClick={handleSignOut}
          className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
          Sign out
        </button>
      </form>
    </AuthLayout>
  )
}
