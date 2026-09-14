import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // En dev, on préfère un message clair plutôt qu'un crash silencieux plus loin.
  // eslint-disable-next-line no-console
  console.warn(
    "[supabase] NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_ANON_KEY manquant(s). " +
      "Ajoutez-les dans .env.local (voir README)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
