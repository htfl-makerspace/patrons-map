import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { authLinkError, supabase } from "~/lib/supabase"
import { useAuth } from "~/hooks/useAuth"
import { Button } from "~/ui/button"
import { AuthLayout, authInputClass } from "~/components/auth-layout"

export const Route = createFileRoute("/login")({
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const { session, loading } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  if (!loading && session) {
    navigate({ to: "/", replace: true })
    return null
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError("")
    setSubmitting(true)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setSubmitting(false)
    } else {
      navigate({ to: "/", replace: true })
    }
  }

  return (
    <AuthLayout title="Sign in">
      <form onSubmit={handleSubmit} className="grid gap-4">
        {authLinkError && !error && (
          <p className="text-sm text-destructive">
            {authLinkError}. Ask for a new invite, or use “Forgot password?”
            below.
          </p>
        )}
        <div className="grid gap-2">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInputClass}
          />
        </div>
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <Link
              to="/forgot-password"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline">
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputClass}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  )
}
