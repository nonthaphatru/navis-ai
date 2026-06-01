import { createClient } from "@supabase/supabase-js";

// These are PUBLIC values. The anon key is sent with every client request and
// is safe to ship in a static site -- Row Level Security is what protects data.
const SUPABASE_URL = "https://tyvbgvkxqafwtikacjhf.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5dmJndmt4cWFmd3Rpa2FjamhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNzg5MjQsImV4cCI6MjA5NTg1NDkyNH0.0zSynFEmwjgZDtY_jXUGgXiGCVi-P3KLdfe_LUqY584";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    flowType: "pkce",
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
});
