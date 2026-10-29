import { createClient } from "@supabase/supabase-js"

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY environment variables"
  )
}

// Invite and password-reset emails land on the app with tokens in the URL
// hash. supabase-js consumes and clears the hash when the client is created,
// so read the link type first. The flag lives in sessionStorage so a reload
// can't skip the set-password step.
const PASSWORD_SETUP_KEY = "htfl:needs-password"
const hashParams = new URLSearchParams(window.location.hash.slice(1))
const linkType = hashParams.get("type")
if (linkType === "invite" || linkType === "recovery") {
  sessionStorage.setItem(PASSWORD_SETUP_KEY, "1")
}

/** Error from an expired or invalid email link, shown on the login page. */
export const authLinkError = hashParams.get("error_description")

export function needsPasswordSetup() {
  return sessionStorage.getItem(PASSWORD_SETUP_KEY) === "1"
}

export function clearPasswordSetup() {
  sessionStorage.removeItem(PASSWORD_SETUP_KEY)
}

export const supabase = createClient(supabaseUrl, supabaseKey)

supabase.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") {
    sessionStorage.setItem(PASSWORD_SETUP_KEY, "1")
  } else if (event === "SIGNED_OUT") {
    clearPasswordSetup()
  }
})
