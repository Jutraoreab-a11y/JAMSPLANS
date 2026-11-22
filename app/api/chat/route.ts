import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// =========================================================
// /api/chat — conversation libre du module Langue, avec Gemini (offre gratuite
// de Google AI Studio : pas de carte bancaire). Réservé aux comptes connectés
// (token Supabase revérifié ici), avec une limite de messages par heure.
//
// Variables d'environnement (Vercel) :
//   GEMINI_API_KEY  (obligatoire) : clé gratuite créée sur aistudio.google.com
//   GEMINI_MODEL    (facultatif)  : un nom de modèle à essayer en premier
// Si un modèle n'existe plus ou si son quota gratuit est atteint, on essaie le suivant.
// =========================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LANGS: Record<string, string> = { en: 'anglais', es: 'espagnol', zh: 'mandarin (caractères simplifiés, avec le pinyin entre parenthèses)', ar: 'arabe standard (avec la translittération entre parenthèses)' };
const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.1-flash-lite'];
const MAX_PER_HOUR = 60;
const hits = new Map<string, number[]>();

function tooMany(userId: string): boolean {
  const now = Date.now();
  const list = (hits.get(userId) || []).filter((t) => now - t < 3600_000);
  if (list.length >= MAX_PER_HOUR) { hits.set(userId, list); return true; }
  list.push(now);
  hits.set(userId, list);
  return false;
}

export async function POST(request: Request) {
  try {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return NextResponse.json({ error: 'Session manquante.' }, { status: 401 });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    if (!supabaseUrl || !anonKey) return NextResponse.json({ error: 'Supabase non configuré.' }, { status: 500 });

    const { data: u, error: uerr } = await createClient(supabaseUrl, anonKey).auth.getUser(token);
    if (uerr || !u?.user) return NextResponse.json({ error: 'Session invalide ou expirée.' }, { status: 401 });

    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) return NextResponse.json({ error: 'Conversation non activée (clé GEMINI_API_KEY manquante).' }, { status: 503 });

    if (tooMany(u.user.id)) return NextResponse.json({ error: 'Trop de messages, réessaie plus tard.' }, { status: 429 });

    const body = await request.json().catch(() => ({}));
    const langName = LANGS[String(body.lang)];
    if (!langName) return NextResponse.json({ error: 'Langue inconnue.' }, { status: 400 });
    const topic = String(body.topic || 'Vie quotidienne').slice(0, 60);

    const raw = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
    const contents: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];
    for (const m of raw) {
      const role = m?.role === 'assistant' ? 'model' : 'user';
      const text = String(m?.content || '').slice(0, 1000).trim();
      if (!text) continue;
      const last = contents[contents.length - 1];
      if (last && last.role === role) { last.parts[0].text += '\n' + text; continue; }
      contents.push({ role, parts: [{ text }] });
    }
    if (!contents.length || contents[0].role !== 'user') {
      contents.unshift({ role: 'user', parts: [{ text: '(Commence la conversation sur le sujet.)' }] });
    }

    const system =
      `Tu es un partenaire de conversation orale bienveillant pour un francophone qui apprend cette langue : ${langName}. ` +
      `Sujet : ${topic}. Réponds TOUJOURS dans cette langue, en 1 à 3 phrases courtes et naturelles (niveau débutant à intermédiaire), ` +
      `puis pose une question pour relancer la conversation. ` +
      `Si le dernier message de l'apprenant contient des fautes, liste-les dans "corrections" (3 au maximum), avec une explication courte en français. ` +
      `Ne corrige pas ce qui est correct ; sinon "corrections" est un tableau vide. ` +
      `Réponds uniquement avec un objet JSON valide : {"reply":"...","corrections":[{"wrong":"...","right":"...","why":"..."}]}`;

    const order = [process.env.GEMINI_MODEL, ...MODELS].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);
    let text = '';
    let lastStatus = 0;
    for (const model of order) {
      const resp = await fetch(`${process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com'}/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
          generationConfig: { maxOutputTokens: 1200, responseMimeType: 'application/json' },
        }),
      });
      lastStatus = resp.status;
      if (resp.ok) {
        const data = await resp.json();
        text = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || '').join('').trim();
        if (text) break;
        continue;
      }
      console.error('Gemini', model, resp.status, (await resp.text().catch(() => '')).slice(0, 300));
      if (resp.status === 401 || resp.status === 403) break; // clé invalide : inutile d'essayer les autres
    }
    if (!text) {
      return NextResponse.json({ error: 'Le service gratuit est indisponible ou son quota est atteint.' }, { status: lastStatus === 429 ? 429 : 502 });
    }

    let reply = text;
    let corrections: { wrong: string; right: string; why: string }[] = [];
    try {
      const start = text.indexOf('{'), end = text.lastIndexOf('}');
      const parsed = JSON.parse(start >= 0 ? text.slice(start, end + 1) : text);
      if (typeof parsed.reply === 'string') reply = parsed.reply;
      if (Array.isArray(parsed.corrections)) {
        corrections = parsed.corrections
          .filter((c: any) => c && c.wrong && c.right)
          .slice(0, 3)
          .map((c: any) => ({ wrong: String(c.wrong), right: String(c.right), why: String(c.why || '') }));
      }
    } catch { /* texte brut : on l'affiche tel quel */ }

    return NextResponse.json({ reply, corrections });
  } catch (err: any) {
    console.error('Erreur /api/chat :', err);
    return NextResponse.json({ error: 'Erreur inconnue.' }, { status: 500 });
  }
}
