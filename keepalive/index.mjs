// Keeps the Supabase free-tier project from pausing (it pauses after 7 days
// of inactivity) by calling a trivial Postgres function through the REST API.
// The function is defined in supabase/migrations/*_lock_down_public_schema.sql.
// Runs as a Railway cron job; exits non-zero on failure so Railway flags it.

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_PUBLISHABLE_KEY

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY")
  process.exit(1)
}

let res
try {
  res = await fetch(`${url}/rest/v1/rpc/keepalive`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(30_000),
  })
} catch (err) {
  console.error(`Ping failed: ${err.cause?.code ?? err.message}`)
  process.exit(1)
}

if (!res.ok) {
  console.error(`Ping failed: ${res.status} ${await res.text()}`)
  process.exit(1)
}

console.log(`Ping ok: ${res.status} at ${new Date().toISOString()}`)
