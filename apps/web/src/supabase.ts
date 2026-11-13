import { createClient } from '@supabase/supabase-js';

// Lecture seule côté client : vues de `public` sous règles par ligne. Les écritures passent par l'API de jeu.
export const supabase = createClient(
  import.meta.env['VITE_SUPABASE_URL'] as string,
  import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY'] as string,
);
