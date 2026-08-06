import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Verify the caller is authenticated
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing authorization" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await anonClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Use service role to query data (bypasses RLS)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Fetch all rows (supabase-js defaults to 1000 limit)
  const allRows: Record<string, unknown>[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  let fetchError = null;

  while (true) {
    const { data: page, error } = await supabase
      .from("patron_ha")
      .select("barcode,latitude,longitude,created,date_issued,p_type,zip,address,circ_active,birth_date,card_at")
      .not("latitude", "is", null)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      fetchError = error;
      break;
    }

    allRows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const data = allRows;
  const error = fetchError;

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const geojson = {
    type: "FeatureCollection",
    features: data.map((r: Record<string, unknown>) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [r.longitude, r.latitude],
      },
      properties: {
        created: r.created,
        date_issued: r.date_issued,
        p_type: r.p_type,
        zip: r.zip,
        address: r.address,
        circ_active: r.circ_active,
        birth_date: r.birth_date,
        card_at: r.card_at,
      },
    })),
  };

  return new Response(JSON.stringify(geojson), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/geo+json",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
});
