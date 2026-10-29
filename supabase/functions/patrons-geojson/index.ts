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
      .from("patron_ha_dev")
      .select("barcode,latitude,longitude,created,date_issued,p_type,zip,address,circ_active,birth_date,card_at,geocode_confidence,census_tract_geoid,block_group_geoid,tot_chkout,cur_chkout")
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

  const now = new Date();

  const computeAgeGroup = (birthDate: unknown): string => {
    if (!birthDate || typeof birthDate !== "string") return "unknown";
    const bd = new Date(birthDate);
    if (isNaN(bd.getTime())) return "unknown";
    let age = now.getFullYear() - bd.getFullYear();
    const monthDiff = now.getMonth() - bd.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < bd.getDate())) {
      age--;
    }
    if (age <= 9) return "0-9";
    if (age <= 17) return "10-17";
    if (age <= 34) return "18-34";
    if (age <= 64) return "35-64";
    return "65+";
  };

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
        age_group: computeAgeGroup(r.birth_date),
        card_at: r.card_at,
        geocode_confidence: r.geocode_confidence,
        census_tract_geoid: r.census_tract_geoid,
        block_group_geoid: r.block_group_geoid,
        tot_chkout: r.tot_chkout,
        cur_chkout: r.cur_chkout,
      },
    })),
  };

  return new Response(JSON.stringify(geojson), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/geo+json",
      "Cache-Control": "private, max-age=3600",
    },
  });
});
