import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// =========================================================
// /api/delete-account — appelé depuis l'écran de connexion (onglet
// "Supprimer mon compte"), après que le client a revérifié le mot de
// passe de l'utilisateur via signInWithPassword.
//
// On ne fait jamais confiance à un identifiant envoyé par le client : le
// token d'accès de la session fraîchement authentifiée est revérifié
// ici côté serveur (auth.getUser) avant toute suppression, avec la clé
// publique (anon). La suppression elle-même nécessite ensuite la clé
// service_role (auth.admin.deleteUser), jamais exposée au navigateur.
// La suppression du compte Auth entraîne la suppression en cascade de
// la ligne profiles (et de tout ce qui en dépend) via les contraintes
// "on delete cascade" définies dans supabase/schema.sql.
// =========================================================

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return NextResponse.json({ error: 'Session manquante : reconnecte-toi puis réessaie.' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY manquante côté serveur : suppression impossible.' },
        { status: 500 }
      );
    }

    // Vérifie le token tel quel, sans faire confiance à un id envoyé par le client.
    const authClient = createClient(supabaseUrl, anonKey || serviceKey);
    const { data: userRes, error: userErr } = await authClient.auth.getUser(token);
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: 'Session invalide ou expirée.' }, { status: 401 });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { error: deleteErr } = await admin.auth.admin.deleteUser(userRes.user.id);
    if (deleteErr) throw deleteErr;

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Erreur lors de la suppression du compte :', err);
    return NextResponse.json({ error: err.message || 'Erreur inconnue.' }, { status: 500 });
  }
}
