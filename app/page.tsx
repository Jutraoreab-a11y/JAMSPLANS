'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

// Initialisation sécurisée (évite le crash si les clés manquent)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export default function CarnetDeDisciplineApp() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [authMessage, setAuthMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);

  const [activeTab, setActiveTab] = useState<'planning' | 'checkin' | 'scoring'>('scoring');
  const [targetSubview, setTargetSubview] = useState<'objectif' | 'planning' | 'archive'>('objectif');
  const [scorePeriod, setScorePeriod] = useState<'7' | '30'>('7');

  const [objectives, setObjectives] = useState<any[]>([]);
  const [checkins, setCheckins] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>({ full_name: '' });

  useEffect(() => {
    if (!supabaseUrl || !supabaseKey) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      if (session) fetchUserData(session.user.id);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchUserData(session.user.id);
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchUserData = async (userId: string) => {
    try {
      const { data: profileData } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (profileData) setProfile(profileData);

      const { data: objData } = await supabase.from('objectives').select('*').eq('user_id', userId);
      if (objData) setObjectives(objData);

      const { data: checkinData } = await supabase.from('checkins').select('*').eq('user_id', userId);
      if (checkinData) setCheckins(checkinData);
    } catch (err) {
      console.error("Erreur lors de la récupération des données :", err);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthMessage(null);

    if (!supabaseUrl || !supabaseKey) {
      setAuthMessage({ text: "Erreur : Les clés Supabase ne sont pas configurées dans .env.local", type: 'error' });
      return;
    }

    if (authMode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) {
        setAuthMessage({ text: error.message, type: 'error' });
      } else {
        if (data.user) {
          await supabase.from('profiles').upsert({ id: data.user.id, full_name: fullName, updated_at: new Date() });
        }
        setAuthMessage({ text: 'Compte créé avec succès ! Connectez-vous.', type: 'success' });
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setAuthMessage({ text: error.message, type: 'error' });
      }
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  if (loading) {
    return (
      <div style={{ background: '#F5F4F0', color: '#2C2A29', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif' }}>
        Chargement de l'application...
      </div>
    );
  }

  // Si pas de session (ou pas encore configuré), affiche l'écran de connexion élégant
  if (!session) {
    return (
      <div style={{ background: '#F5F4F0', color: '#2C2A29', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        <div style={{ width: '100%', maxWidth: '380px', border: '1px solid #E3E1DA', background: '#FFFFFF', borderRadius: '8px', padding: '32px 24px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '24px', marginBottom: '6px', fontWeight: 'normal' }}>Carnet de Discipline</h1>
          <p style={{ fontSize: '13px', color: '#6B6865', margin: '0 0 24px' }}>Objectifs, routines et régularité au quotidien.</p>

          {!supabaseUrl && (
            <div style={{ background: '#FFF3CD', border: '1px solid #FFEEBA', color: '#856404', padding: '10px', fontSize: '12px', borderRadius: '4px', marginBottom: '16px' }}>
              ⚠️ Clés Supabase manquantes dans `.env.local`. Le mode démo est actif.
            </div>
          )}

          <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', borderBottom: '1px solid #E3E1DA' }}>
            <button
              type="button"
              onClick={() => { setAuthMode('signin'); setAuthMessage(null); }}
              style={{ background: 'none', border: 'none', fontSize: '14px', color: authMode === 'signin' ? '#2C2A29' : '#8C8885', padding: '0 0 8px', cursor: 'pointer', borderBottom: authMode === 'signin' ? '2px solid #2C2A29' : '2px solid transparent', fontWeight: authMode === 'signin' ? 500 : 400 }}
            >
              Se connecter
            </button>
            <button
              type="button"
              onClick={() => { setAuthMode('signup'); setAuthMessage(null); }}
              style={{ background: 'none', border: 'none', fontSize: '14px', color: authMode === 'signup' ? '#2C2A29' : '#8C8885', padding: '0 0 8px', cursor: 'pointer', borderBottom: authMode === 'signup' ? '2px solid #2C2A29' : '2px solid transparent', fontWeight: authMode === 'signup' ? 500 : 400 }}
            >
              S'inscrire
            </button>
          </div>

          <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {authMode === 'signup' && (
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#6B6865', marginBottom: '4px' }}>Nom complet</label>
                <input
                  type="text"
                  placeholder="Votre nom"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  style={{ width: '100%', border: '1px solid #E3E1DA', background: '#FAFAF8', borderRadius: '6px', padding: '9px 12px', fontSize: '14px', outline: 'none' }}
                />
              </div>
            )}
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#6B6865', marginBottom: '4px' }}>E-mail</label>
              <input
                type="email"
                placeholder="vous@exemple.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ width: '100%', border: '1px solid #E3E1DA', background: '#FAFAF8', borderRadius: '6px', padding: '9px 12px', fontSize: '14px', outline: 'none' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#6B6865', marginBottom: '4px' }}>Mot de passe</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ width: '100%', border: '1px solid #E3E1DA', background: '#FAFAF8', borderRadius: '6px', padding: '9px 12px', fontSize: '14px', outline: 'none' }}
              />
            </div>

            {authMessage && (
              <p style={{ fontSize: '12.5px', color: authMessage.type === 'error' ? '#D32F2F' : '#388E3C', margin: '4px 0' }}>
                {authMessage.text}
              </p>
            )}

            <button
              type="submit"
              style={{ marginTop: '8px', background: '#2C2A29', color: '#FFFFFF', border: 'none', borderRadius: '6px', padding: '10px 16px', fontSize: '14px', cursor: 'pointer', fontWeight: 500 }}
            >
              {authMode === 'signin' ? 'Se connecter' : "S'inscrire"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Application principale
  return (
    <div style={{ background: '#F5F4F0', minHeight: '100vh', color: '#2C2A29', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <header style={{ borderBottom: '1px solid #E3E1DA', background: '#FFFFFF' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '24px 16px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '26px', margin: 0, fontWeight: 'normal' }}>Carnet de Discipline</h1>
            <p style={{ margin: '4px 0 0', fontSize: '13.5px', color: '#6B6865' }}>Objectifs, routines et régularité au quotidien.</p>
          </div>
          <button
            onClick={handleSignOut}
            style={{ border: '1px solid #E3E1DA', background: '#FAFAF8', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', color: '#6B6865', cursor: 'pointer' }}
          >
            Se déconnecter ({profile?.full_name || session.user.email})
          </button>
        </div>
      </header>

      <nav style={{ borderBottom: '1px solid #E3E1DA', background: '#FFFFFF', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', gap: '8px', padding: '0 16px' }}>
          <button
            onClick={() => setActiveTab('planning')}
            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '14px 12px', fontSize: '14px', color: activeTab === 'planning' ? '#2C2A29' : '#8C8885', borderBottom: activeTab === 'planning' ? '2px solid #2C2A29' : '2px solid transparent', fontWeight: activeTab === 'planning' ? 500 : 400 }}
          >
            📄 Objectifs & Planning
          </button>
          <button
            onClick={() => setActiveTab('checkin')}
            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '14px 12px', fontSize: '14px', color: activeTab === 'checkin' ? '#2C2A29' : '#8C8885', borderBottom: activeTab === 'checkin' ? '2px solid #2C2A29' : '2px solid transparent', fontWeight: activeTab === 'checkin' ? 500 : 400 }}
          >
            ✓ Check-in du soir
          </button>
          <button
            onClick={() => setActiveTab('scoring')}
            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '14px 12px', fontSize: '14px', color: activeTab === 'scoring' ? '#2C2A29' : '#8C8885', borderBottom: activeTab === 'scoring' ? '2px solid #2C2A29' : '2px solid transparent', fontWeight: activeTab === 'scoring' ? 500 : 400 }}
          >
            ⊞ Planning & Scoring
          </button>
        </div>
      </nav>

      <main style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 16px 64px' }}>
        {activeTab === 'planning' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '24px' }}>
              <button onClick={() => setTargetSubview('objectif')} style={{ border: '1px solid #E3E1DA', background: targetSubview === 'objectif' ? '#FFFFFF' : '#FAFAF8', color: '#2C2A29', borderRadius: '6px', padding: '10px', cursor: 'pointer' }}>Objectifs ({objectives.length})</button>
              <button onClick={() => setTargetSubview('planning')} style={{ border: '1px solid #E3E1DA', background: targetSubview === 'planning' ? '#FFFFFF' : '#FAFAF8', color: '#2C2A29', borderRadius: '6px', padding: '10px', cursor: 'pointer' }}>Planning</button>
              <button onClick={() => setTargetSubview('archive')} style={{ border: '1px solid #E3E1DA', background: targetSubview === 'archive' ? '#FFFFFF' : '#FAFAF8', color: '#2C2A29', borderRadius: '6px', padding: '10px', cursor: 'pointer' }}>Archive</button>
            </div>
            {targetSubview === 'objectif' && (
              <div>
                <h2 style={{ fontFamily: 'Georgia, serif', fontWeight: 'normal', margin: '0 0 16px' }}>Vos objectifs enregistrés</h2>
                {objectives.length === 0 ? (
                  <div style={{ border: '1px dashed #E3E1DA', background: '#FFFFFF', borderRadius: '8px', padding: '32px', textAlign: 'center', color: '#6B6865' }}>
                    Aucun objectif trouvé.
                  </div>
                ) : (
                  objectives.map((obj) => (
                    <div key={obj.id} style={{ border: '1px solid #E3E1DA', background: '#FFFFFF', borderRadius: '8px', padding: '16px', marginBottom: '8px' }}>
                      <div style={{ fontWeight: 500 }}>{obj.title}</div>
                    </div>
                  ))
                )}
              </div>
            )}
            {targetSubview === 'planning' && <p style={{ color: '#6B6865' }}>Planning en cours de configuration.</p>}
            {targetSubview === 'archive' && <p style={{ color: '#6B6865' }}>Archives vides.</p>}
          </div>
        )}

        {activeTab === 'checkin' && (
          <div>
            <h2 style={{ fontFamily: 'Georgia, serif', fontWeight: 'normal', margin: '0 0 6px' }}>Check-in du soir</h2>
            <div style={{ border: '1px solid #E3E1DA', background: '#FFFFFF', borderRadius: '8px', padding: '24px' }}>
              <p style={{ margin: 0, color: '#6B6865' }}>Module de check-in connecté.</p>
            </div>
          </div>
        )}

        {activeTab === 'scoring' && (
          <div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <button onClick={() => setScorePeriod('7')} style={{ border: '1px solid #E3E1DA', background: scorePeriod === '7' ? '#2C2A29' : '#FFFFFF', color: scorePeriod === '7' ? '#FFFFFF' : '#2C2A29', borderRadius: '6px', padding: '6px 14px', fontSize: '13px', cursor: 'pointer' }}>7 derniers jours</button>
              <button onClick={() => setScorePeriod('30')} style={{ border: '1px solid #E3E1DA', background: scorePeriod === '30' ? '#2C2A29' : '#FFFFFF', color: scorePeriod === '30' ? '#FFFFFF' : '#2C2A29', borderRadius: '6px', padding: '6px 14px', fontSize: '13px', cursor: 'pointer' }}>30 derniers jours</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
              <div style={{ border: '1px solid #E3E1DA', background: '#FFFFFF', borderRadius: '8px', padding: '16px' }}>
                <div style={{ fontSize: '12.5px', color: '#6B6865' }}>Discipline</div>
                <div style={{ fontSize: '24px', fontWeight: 500, marginTop: '8px' }}>0.0%</div>
              </div>
              <div style={{ border: '1px solid #E3E1DA', background: '#FFFFFF', borderRadius: '8px', padding: '16px' }}>
                <div style={{ fontSize: '12.5px', color: '#6B6865' }}>Performance</div>
                <div style={{ fontSize: '24px', fontWeight: 500, marginTop: '8px' }}>0.0%</div>
              </div>
              <div style={{ border: '1px solid #E3E1DA', background: '#FFFFFF', borderRadius: '8px', padding: '16px' }}>
                <div style={{ fontSize: '12.5px', color: '#6B6865' }}>Heures</div>
                <div style={{ fontSize: '20px', fontWeight: 500, marginTop: '8px' }}>0.0h / 0.0h</div>
              </div>
              <div style={{ border: '1px solid #E3E1DA', background: '#FFFFFF', borderRadius: '8px', padding: '16px' }}>
                <div style={{ fontSize: '12.5px', color: '#6B6865' }}>Série en cours</div>
                <div style={{ fontSize: '24px', fontWeight: 500, marginTop: '8px' }}>0 j</div>
              </div>
            </div>

            <div style={{ border: '1px solid #E3E1DA', background: '#FFFFFF', borderRadius: '8px', padding: '24px', textAlign: 'center', color: '#6B6865' }}>
              Aucune donnée pour cette période ({checkins.length} check-in).
            </div>
          </div>
        )}
      </main>
    </div>
  );
}