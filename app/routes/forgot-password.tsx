import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { supabase } from "~/lib/supabase"
import { useAuth } from "~/hooks/useAuth"
import { Button } from "~/ui/button"
import { AuthLayout, authInputClass } from "~/components/auth-layout"

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const navigate = useNavigate()
  const { session, loading } = useAuth()
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && session) {
    navigate({ to: "/", replace: true })
    return null
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError("")
    setSubmitting(true)

    // The reset link signs the user in and lands on the app root; the root
    // route then sends them to /set-password.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
    })

    setSubmitting(false)
    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
  }

  return (
    <AuthLayout title="Reset password">
      {sent ? (
        <div className="grid gap-4">
          <p className="text-sm">
            If an account exists for <strong>{email}</strong>, we've sent a
            link to reset your password. The link expires in 1 hour.
          </p>
          <BackToSignIn />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            Enter your email and we'll send you a link to set a new password.
          </p>
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
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Sending…" : "Send reset link"}
          </Button>
          <BackToSignIn />
        </form>
      )}
    </AuthLayout>
  )
}

function BackToSignIn() {
  return (
    <Link
      to="/login"
      className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
      Back to sign in
    </Link>
  )
}
