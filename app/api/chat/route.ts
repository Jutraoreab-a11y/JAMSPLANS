import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// =========================================================
// /api/chat — partenaire de conversation du module Langue.
// Réservé aux comptes connectés (token Supabase revérifié ici), avec une
// limite de messages par heure et par compte pour protéger la clé API.
// Variables d'environnement (Vercel) :
//   ANTHROPIC_API_KEY  (obligatoire)
//   ANTHROPIC_MODEL    (facultatif, défaut claude-haiku-4-5)
// =========================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LANGS: Record<string, string> = { en: 'anglais', es: 'espagnol', zh: 'mandarin (caractères simplifiés)', ar: 'arabe standard' };
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

    const auth = createClient(supabaseUrl, anonKey);
    const { data: u, error: uerr } = await auth.auth.getUser(token);
    if (uerr || !u?.user) return NextResponse.json({ error: 'Session invalide ou expirée.' }, { status: 401 });

    const apiKey = process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey) return NextResponse.json({ error: 'Conversation non activée (clé API manquante).' }, { status: 503 });

    if (tooMany(u.user.id)) return NextResponse.json({ error: 'Trop de messages, réessaie plus tard.' }, { status: 429 });

    const body = await request.json().catch(() => ({}));
    const langName = LANGS[String(body.lang)];
    if (!langName) return NextResponse.json({ error: 'Langue inconnue.' }, { status: 400 });
    const topic = String(body.topic || 'Vie quotidienne').slice(0, 60);

    const raw = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
    const messages: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const m of raw) {
      const role = m?.role === 'assistant' ? 'assistant' : 'user';
      const content = String(m?.content || '').slice(0, 1000).trim();
      if (!content) continue;
      if (messages.length && messages[messages.length - 1].role === role) { messages[messages.length - 1].content += '\n' + content; continue; }
      messages.push({ role, content });
    }
    if (!messages.length || messages[0].role !== 'user') {
      messages.unshift({ role: 'user', content: '(Commence la conversation sur le sujet.)' });
    }

    const system =
      `Tu es un partenaire de conversation bienveillant pour un francophone qui apprend la langue suivante : ${langName}. ` +
      `Sujet de la conversation : ${topic}. ` +
      `Réponds TOUJOURS en ${langName}, en 1 à 3 phrases courtes et simples (niveau débutant à intermédiaire), puis pose une question pour relancer. ` +
      `Si le dernier message de l'apprenant contient des fautes, liste-les dans "corrections" (maximum 3), avec une explication courte en français. ` +
      `Ne corrige pas ce qui est correct. Si le message est correct, "corrections" est un tableau vide. ` +
      `Réponds uniquement avec un objet JSON valide, sans texte autour, de la forme : ` +
      `{"reply":"...","corrections":[{"wrong":"...","right":"...","why":"..."}]}`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
        max_tokens: 500,
        system,
        messages,
      }),
    });
    if (!resp.ok) {
      console.error('Anthropic API', resp.status, await resp.text().catch(() => ''));
      return NextResponse.json({ error: 'Le service de conversation est indisponible.' }, { status: 502 });
    }
    const data = await resp.json();
    const text: string = (data?.content || []).map((c: any) => c?.text || '').join('').trim();

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
