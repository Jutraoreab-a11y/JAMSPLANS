import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey);
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseClient();

    if (!supabase) {
      return NextResponse.json(
        { error: 'Variables d’environnement Supabase manquantes.' },
        { status: 500 }
      );
    }

    const { data: users, error } = await supabase
      .from('profiles')
      .select('email, full_name');

    if (error) throw error;

    if (!users || users.length === 0) {
      return NextResponse.json({ message: 'Aucun utilisateur trouvé.' }, { status: 200 });
    }

    const makeWebhookUrl = 'https://hook.eu1.make.com/teu8k7bx0qxdrp92xpgi5v052dvbq89w';

    for (const user of users) {
      await fetch(makeWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: user.email,
          name: user.full_name || 'Utilisateur',
        }),
      });
    }

    return NextResponse.json({
      success: true,
      message: `${users.length} rappels envoyés avec succès via Make.com !`,
    });
  } catch (err: any) {
    console.error("Erreur lors de l'envoi des rappels:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
