import { createClient } from '@supabase/supabase-js';

// Sert uniquement à l'authentification (lien magique, second facteur). Toute donnée passe par l'API de jeu.
export const supabase = createClient(
  import.meta.env['VITE_SUPABASE_URL'] as string,
  import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY'] as string,
);
