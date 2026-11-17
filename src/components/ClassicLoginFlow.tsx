import React, { useState } from 'react';
import { LogOut, Play, Plus, Shield, Sparkles, UserPlus, Users } from 'lucide-react';
import { MU_CLASSES } from '../data/muSkillsAndClasses';
import type { HeroClass, MuAccount, MuCharacter } from '../types/game';
import { PWAInstallButton } from './PWAInstallButton';

interface ClassicLoginFlowProps {
  stage: 'login' | 'character_select';
  accounts: MuAccount[];
  currentAccount: MuAccount | null;
  characters: MuCharacter[];
  selectedCharId: string | null;
  onLogin: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  onRegister: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  onSelectCharacter: (charId: string) => void;
  onCreateCharacter: (name: string, classType: HeroClass) => Promise<void>;
  onEnterWorld: () => void;
  onLogoutAccount: () => void;
  onOpenApkCenter: () => void;
  onPreviewClass: (classType: HeroClass) => void;
}

export const ClassicLoginFlow: React.FC<ClassicLoginFlowProps> = ({
  stage,
  accounts,
  currentAccount,
  characters,
  selectedCharId,
  onLogin,
  onRegister,
  onSelectCharacter,
  onCreateCharacter,
  onEnterWorld,
  onLogoutAccount,
  onOpenApkCenter,
  onPreviewClass,
}) => {
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState(accounts[0]?.username || 'lorencia');
  const [password, setPassword] = useState('123456');
  const [authError, setAuthError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [creatingChar, setCreatingChar] = useState(false);
  const [newCharName, setNewCharName] = useState('');
  const [newCharClass, setNewCharClass] = useState<HeroClass>('DK');

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setBusy(true);
    try {
      const res =
        authTab === 'login'
          ? await onLogin(username, password)
          : await onRegister(username, password);
      if (!res.ok) {
        setAuthError(res.error || 'Error de acceso.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCharName.trim()) return;
    await onCreateCharacter(newCharName.trim(), newCharClass);
    setNewCharName('');
    setCreatingChar(false);
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-between p-4 sm:p-6 bg-gradient-to-b from-[#080b12]/70 via-[#080b12]/35 to-[#080b12]/88 overflow-y-auto mu-scroll">
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-3 shrink-0">
        <div className="text-xs text-amber-200/90 font-mono-tabular">
          MU Online Season 6 · Episodio 3 · SQLite Offline
        </div>
        <div className="flex items-center gap-2">
          <PWAInstallButton onOpenApkCenter={onOpenApkCenter} />
          {stage === 'character_select' && currentAccount && (
            <button
              onClick={onLogoutAccount}
              className="min-h-[40px] px-3 rounded-lg bg-[#151b28] border border-slate-700 hover:border-amber-500/60 text-xs text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Cuenta ({currentAccount.username})
            </button>
          )}
        </div>
      </div>

      {/* STAGE 1: CLASSIC MU S6 EP3 LOGIN */}
      {stage === 'login' && (
        <div className="my-auto mx-auto w-full max-w-md space-y-4">
          <div className="text-center">
            <svg viewBox="0 0 460 88" className="w-full max-w-[360px] mx-auto h-auto" role="img" aria-label="MU Season 6 Ep 3">
              <defs>
                <linearGradient id="muS6Gold" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#fef3c7" />
                  <stop offset="50%" stopColor="#f59e0b" />
                  <stop offset="100%" stopColor="#b45309" />
                </linearGradient>
              </defs>
              <text
                x="230"
                y="50"
                textAnchor="middle"
                fill="url(#muS6Gold)"
                fontFamily="Cinzel, Georgia, serif"
                fontWeight="700"
                fontSize="42"
                letterSpacing="4"
              >
                MU LORENCIA
              </text>
              <text
                x="230"
                y="76"
                textAnchor="middle"
                fill="#cbd5e1"
                fontFamily="Plus Jakarta Sans, sans-serif"
                fontWeight="600"
                fontSize="13"
                letterSpacing="4"
              >
                SEASON 6 · EPISODIO 3
              </text>
            </svg>
          </div>

          <div className="rounded-xl bg-[#0e131f]/95 border-2 border-amber-700/70 shadow-2xl overflow-hidden">
            {/* Classic Server Banner */}
            <div className="px-4 py-2.5 bg-[#171d2c] border-b border-amber-700/40 flex items-center justify-between text-xs">
              <span className="font-semibold text-amber-300">Servidor: Lorencia-Offline-1</span>
              <span className="font-mono-tabular text-emerald-300">Base SQLite Lista</span>
            </div>

            {/* Auth Mode Tabs */}
            <div className="grid grid-cols-2 border-b border-slate-800 bg-[#0b0f18]">
              <button
                type="button"
                onClick={() => {
                  setAuthTab('login');
                  setAuthError(null);
                }}
                className={`min-h-[44px] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                  authTab === 'login'
                    ? 'bg-amber-600/20 text-amber-300 border-b-2 border-amber-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                Ingresar Cuenta
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthTab('register');
                  setAuthError(null);
                  setUsername('');
                  setPassword('');
                }}
                className={`min-h-[44px] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                  authTab === 'register'
                    ? 'bg-amber-600/20 text-amber-300 border-b-2 border-amber-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" />
                Registrar Primera Vez
              </button>
            </div>

            <form onSubmit={handleAuthSubmit} className="p-4 space-y-3">
              {authError && (
                <div className="p-2.5 rounded-lg bg-rose-950/80 border border-rose-500/50 text-xs text-rose-200">
                  {authError}
                </div>
              )}

              <div>
                <label className="block text-xs text-slate-300 mb-1">ID de Cuenta (Usuario)</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="ej. lorencia"
                  required
                  className="w-full min-h-[44px] rounded-lg bg-[#080b12] border border-slate-700 px-3 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">Contraseña</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••"
                  required
                  className="w-full min-h-[44px] rounded-lg bg-[#080b12] border border-slate-700 px-3 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              {accounts.length > 0 && authTab === 'login' && (
                <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-400">
                  <span>Cuentas guardadas:</span>
                  {accounts.map((acc) => (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => {
                        setUsername(acc.username);
                        if (acc.username === 'lorencia') setPassword('123456');
                      }}
                      className="text-amber-300 hover:underline font-mono-tabular cursor-pointer"
                    >
                      {acc.username}
                    </button>
                  ))}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-[46px] rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-sm cursor-pointer"
              >
                {authTab === 'login' ? 'Conectar al Servidor' : 'Crear Cuenta y Continuar'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* STAGE 2: CLASSIC MU CHARACTER SELECT & CREATE */}
      {stage === 'character_select' && (
        <div className="my-auto flex flex-col lg:flex-row items-stretch lg:items-end justify-between gap-4 max-w-6xl w-full mx-auto">
          {/* Left: Character Slots */}
          <div className="w-full lg:w-[400px] rounded-xl bg-[#0e131f]/95 border-2 border-amber-700/60 p-4 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-amber-400" />
                <h2 className="font-display text-sm font-bold text-amber-300">
                  Selección de Personaje ({characters.length}/5)
                </h2>
              </div>
              {characters.length < 5 && !creatingChar && (
                <button
                  onClick={() => {
                    setCreatingChar(true);
                    onPreviewClass(newCharClass);
                  }}
                  className="min-h-[38px] px-3 rounded-lg bg-amber-600/20 border border-amber-500/60 hover:bg-amber-600/30 text-amber-200 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Crear Personaje
                </button>
              )}
            </div>

            {!creatingChar ? (
              <div className="space-y-2 max-h-[240px] overflow-y-auto mu-scroll">
                {characters.length === 0 ? (
                  <div className="p-4 rounded-lg bg-[#090d16] border border-slate-800 text-xs text-slate-400 text-center">
                    Tu cuenta nueva aún no tiene personajes. Toca "Crear Personaje" para elegir entre BK, Mago, Elfa, DL o MG.
                  </div>
                ) : (
                  characters.map((ch) => {
                    const clsMeta = MU_CLASSES.find((m) => m.id === ch.classType);
                    const isSelected = ch.id === selectedCharId;
                    return (
                      <button
                        key={ch.id}
                        onClick={() => onSelectCharacter(ch.id)}
                        className={`w-full p-3 rounded-lg border text-left transition-colors cursor-pointer flex items-center justify-between ${
                          isSelected
                            ? 'bg-[#1a2235] border-amber-500'
                            : 'bg-[#090d16] border-slate-800 hover:border-slate-600'
                        }`}
                      >
                        <div>
                          <div className="text-sm font-bold text-slate-100">{ch.name}</div>
                          <div className="text-xs text-slate-400 font-mono-tabular">
                            {clsMeta?.name || ch.classType} · Nv.{ch.level} · Resets {ch.resets}
                          </div>
                        </div>
                        <span className="text-xs font-mono-tabular text-amber-300">
                          {isSelected ? 'Seleccionado' : 'Elegir'}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            ) : (
              <form onSubmit={handleCreateSubmit} className="space-y-3">
                <div className="text-xs font-semibold text-amber-200">
                  Nuevo Héroe · Elige una de las 5 Razas de MU Online
                </div>
                <div className="grid grid-cols-1 gap-1.5 max-h-[180px] overflow-y-auto mu-scroll">
                  {MU_CLASSES.map((cls) => (
                    <button
                      key={cls.id}
                      type="button"
                      onClick={() => {
                        setNewCharClass(cls.id);
                        onPreviewClass(cls.id);
                      }}
                      className={`p-2.5 rounded-lg border text-left cursor-pointer ${
                        newCharClass === cls.id
                          ? 'bg-[#1c253b] border-amber-500 text-amber-200'
                          : 'bg-[#0a0e17] border-slate-800 text-slate-300'
                      }`}
                    >
                      <div className="text-xs font-bold">{cls.name}</div>
                      <div className="text-[11px] text-slate-400">{cls.role}</div>
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={newCharName}
                  onChange={(e) => setNewCharName(e.target.value)}
                  placeholder="Nombre del personaje (máx 16)"
                  maxLength={16}
                  required
                  className="w-full min-h-[42px] rounded-lg bg-[#080b12] border border-slate-700 px-3 text-sm text-slate-100"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCreatingChar(false)}
                    className="flex-1 min-h-[42px] rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 min-h-[42px] rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 text-xs font-bold cursor-pointer"
                  >
                    Crear Héroe
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Right: Enter World CTA */}
          {!creatingChar && selectedCharId && (
            <div className="w-full lg:w-auto flex flex-col items-stretch lg:items-end gap-2">
              <button
                onClick={onEnterWorld}
                className="min-h-[54px] px-8 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-display font-bold text-base inline-flex items-center justify-center gap-2.5 shadow-2xl cursor-pointer"
              >
                <Play className="w-5 h-5 fill-current" />
                ENTRAR AL JUEGO (CONECTAR)
              </button>
              <div className="text-xs text-slate-300 font-mono-tabular flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                5 Razas · Cámara 3ra Persona y Modo 3D · Controles PUBG
              </div>
            </div>
          )}
        </div>
      )}

      <div className="text-[11px] text-slate-400 font-mono-tabular text-center pt-2 shrink-0">
        Orientación recomendada: Horizontal (Landscape) · Datos guardados automáticamente en SQLite
      </div>
    </div>
  );
};
