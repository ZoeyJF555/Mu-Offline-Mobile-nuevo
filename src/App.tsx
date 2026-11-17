import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Backpack,
  Bluetooth,
  Bot,
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Sword,
  Volume2,
  VolumeX,
  Wifi,
} from 'lucide-react';
import {
  addItemToCharacter,
  createOrSelectClassHero,
  equipItem,
  getChatHistory,
  getEventSessions,
  getItemsForCharacter,
  getSharedLedger,
  initSqlite,
  listCharacters,
  recordSharedLedger,
  removeItemFromCharacter,
  saveChatMessage,
  updateCharacter,
  upgradeItemWithJewel,
  upsertEventSession,
} from './db/sqliteStore';
import { MuWorldEngine, type EngineCallbacks } from './game/MuWorldEngine';
import { soundSynth } from './game/soundSynth';
import { LocalSyncManager } from './services/syncManager';
import { ApkSyncDrawer } from './components/ApkSyncDrawer';
import { InventoryDrawer } from './components/InventoryDrawer';
import { OracleChatDrawer } from './components/OracleChatDrawer';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { SyncLinkDrawer } from './components/SyncLinkDrawer';
import type {
  ChatMessageRecord,
  EventSessionRecord,
  EventType,
  HeroClass,
  MuCharacter,
  MuItem,
  RoomPeer,
  RoomState,
  SharedLedgerEntry,
  TransportMode,
} from './types/game';

interface FloatingBanner {
  id: number;
  text: string;
  color: string;
}

const CLASS_INFO: Array<{ id: HeroClass; title: string; subtitle: string }> = [
  { id: 'DK', title: 'Dark Knight', subtitle: 'Espada y Armadura Dragón' },
  { id: 'DW', title: 'Dark Wizard', subtitle: 'Báculo y Magia Arcana' },
  { id: 'ELF', title: 'Fairy Elf', subtitle: 'Arco Celestial y Agilidad' },
];

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<MuWorldEngine | null>(null);
  const syncRef = useRef<LocalSyncManager | null>(null);

  const [gameState, setGameState] = useState<'title' | 'playing' | 'paused'>('title');
  const [selectedClass, setSelectedClass] = useState<HeroClass>('DK');
  const [heroNameInput, setHeroNameInput] = useState('GuerreroLorencia');
  const [characters, setCharacters] = useState<MuCharacter[]>([]);
  const [character, setCharacter] = useState<MuCharacter | null>(null);
  const [items, setItems] = useState<MuItem[]>([]);
  const [ledger, setLedger] = useState<SharedLedgerEntry[]>([]);
  const [eventHistory, setEventHistory] = useState<EventSessionRecord[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessageRecord[]>([]);

  const [activeDrawer, setActiveDrawer] = useState<'none' | 'inventory' | 'sync' | 'oracle' | 'apk'>('none');
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [muted, setMuted] = useState(false);
  const [forgeMessage, setForgeMessage] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [btDeviceName, setBtDeviceName] = useState<string | null>(null);
  const [banners, setBanners] = useState<FloatingBanner[]>([]);
  const [showTouchPad, setShowTouchPad] = useState(
    () => typeof window !== 'undefined' && ('ontouchstart' in window || window.innerWidth < 900),
  );

  // Refs for stable callbacks inside 3D loop and WebSocket handlers
  const charRef = useRef<MuCharacter | null>(null);
  const itemsRef = useRef<MuItem[]>([]);
  const roomRef = useRef<RoomState | null>(null);
  charRef.current = character;
  itemsRef.current = items;
  roomRef.current = roomState;

  const pushBanner = useCallback((text: string, color = '#fbbf24') => {
    const id = Date.now() + Math.random();
    setBanners((prev) => [...prev.slice(-3), { id, text, color }]);
    setTimeout(() => {
      setBanners((prev) => prev.filter((b) => b.id !== id));
    }, 2400);
  }, []);

  const loadAllFromSqlite = useCallback(async (preferCharId?: string) => {
    await initSqlite();
    const chars = await listCharacters();
    setCharacters(chars);
    const active = (preferCharId && chars.find((c) => c.id === preferCharId)) || chars[0];
    if (active) {
      setCharacter(active);
      setSelectedClass(active.classType);
      setHeroNameInput(active.name);
      const charItems = await getItemsForCharacter(active.id);
      setItems(charItems);
      engineRef.current?.syncHeroAppearance(
        active.classType,
        charItems.filter((i) => i.isEquipped),
      );
    }
    setLedger(await getSharedLedger());
    setEventHistory(await getEventSessions());
    setChatMessages(await getChatHistory());
  }, []);

  // Initialize SQLite on mount
  useEffect(() => {
    loadAllFromSqlite();
    const params = new URLSearchParams(window.location.search);
    if (params.get('sala')) {
      setActiveDrawer('sync');
    }
  }, [loadAllFromSqlite]);

  // Initialize WebSocket / Bluetooth SyncManager once
  useEffect(() => {
    const manager = new LocalSyncManager({
      onConnectionChange: (connected) => setWsConnected(connected),
      onRoomState: (room) => {
        setRoomState(room);
        engineRef.current?.setEventActive(room.activeEvent, room.eventType);
        if (syncRef.current) {
          engineRef.current?.syncRemotePeers(room.peers, syncRef.current.peerId);
        }
        upsertEventSession({
          id: `sess-${room.code}`,
          sessionCode: room.code,
          eventType: room.eventType,
          hostName: room.hostName,
          transportMode: room.transport,
          startedAt: new Date().toISOString(),
          endedAt: null,
          wavesCleared: Math.max(0, room.eventWave - 1),
          bossDefeated: false,
          lootSummary: `En curso (${room.peers.length} jugadores)`,
        }).then(async () => setEventHistory(await getEventSessions()));
      },
      onPeerMoved: (peer) => {
        setRoomState((prev) => {
          if (!prev) return prev;
          const peers = prev.peers.map((p) => (p.peerId === peer.peerId ? peer : p));
          if (syncRef.current) {
            engineRef.current?.syncRemotePeers(peers, syncRef.current.peerId);
          }
          return { ...prev, peers };
        });
      },
      onBossHp: (bossHp, bossMaxHp) => {
        setRoomState((prev) => (prev ? { ...prev, bossHp, bossMaxHp } : prev));
      },
      onEventCompleted: async (room, reward) => {
        setRoomState(room);
        engineRef.current?.setEventActive(false);
        soundSynth.playTradeSync();
        const activeChar = charRef.current;
        if (activeChar) {
          const updated: MuCharacter = {
            ...activeChar,
            zen: activeChar.zen + reward.zenBonus,
            bless: activeChar.bless + reward.blessBonus,
            soul: activeChar.soul + reward.soulBonus,
          };
          await updateCharacter(updated);
          setCharacter(updated);

          const rewardItem: MuItem = {
            id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            charId: activeChar.id,
            name: reward.itemName,
            slot: reward.itemName.includes('Báculo') || reward.itemName.includes('Espada') ? 'weapon' : 'armor',
            category: reward.itemName.includes('Alas') ? 'wings' : reward.itemName.includes('Báculo') || reward.itemName.includes('Espada') ? 'weapon' : 'armor',
            setName: 'Evento Cooperativo',
            rarity: 'excellent',
            enhanceLevel: 7,
            minDmg: 54,
            maxDmg: 82,
            defense: 42,
            magicPower: 68,
            luck: true,
            excellentOpt: 'Recompensa de Evento Guardada en SQLite',
            isEquipped: false,
            originalOwner: room.hostName,
            sharedFromSession: room.code,
            acquiredAt: new Date().toISOString(),
          };
          const nextItems = await addItemToCharacter(activeChar.id, rewardItem);
          setItems(nextItems);

          await recordSharedLedger({
            id: `led-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            sessionId: room.code,
            transportMode: room.transport,
            partnerName: room.hostName,
            role: room.hostPeerId === syncRef.current?.peerId ? 'host' : 'guest',
            direction: 'event_reward',
            itemId: rewardItem.id,
            itemName: `${rewardItem.name} +7`,
            itemSnapshotJson: JSON.stringify(rewardItem),
            status: 'committed',
            createdAt: new Date().toISOString(),
          });
          await upsertEventSession({
            id: `sess-${room.code}`,
            sessionCode: room.code,
            eventType: reward.eventType,
            hostName: room.hostName,
            transportMode: room.transport,
            startedAt: new Date().toISOString(),
            endedAt: null,
            wavesCleared: reward.wave,
            bossDefeated: true,
            lootSummary: `${reward.itemName} +7 · +${reward.zenBonus} Zen`,
          });
          setLedger(await getSharedLedger());
          setEventHistory(await getEventSessions());
        }
        pushBanner(`¡Evento completado! Recibido ${reward.itemName} +7 en SQLite`, '#34d399');
      },
      onTradeReceived: async (payload) => {
        const activeChar = charRef.current;
        if (!activeChar) return;
        const incomingItem: MuItem = {
          ...payload.item,
          id: `${payload.item.id}-rx-${Date.now().toString(36)}`,
          charId: activeChar.id,
          isEquipped: false,
          sharedFromSession: payload.sessionCode,
          acquiredAt: payload.timestamp,
        };
        const nextItems = await addItemToCharacter(activeChar.id, incomingItem);
        setItems(nextItems);

        await recordSharedLedger({
          id: payload.tradeId,
          sessionId: payload.sessionCode,
          transportMode: payload.transport,
          partnerName: payload.fromPeerName,
          role: 'guest',
          direction: 'received',
          itemId: incomingItem.id,
          itemName: `${incomingItem.name} +${incomingItem.enhanceLevel}`,
          itemSnapshotJson: JSON.stringify(incomingItem),
          status: 'committed',
          createdAt: payload.timestamp,
        });
        setLedger(await getSharedLedger());
        soundSynth.playTradeSync();
        setSyncMessage(`Recibiste ${incomingItem.name} +${incomingItem.enhanceLevel} de ${payload.fromPeerName}. Guardado en SQLite.`);
        pushBanner(`Recibido: ${incomingItem.name} +${incomingItem.enhanceLevel}`, '#38bdf8');
      },
      onTradeConfirmed: async (payload) => {
        const activeChar = charRef.current;
        if (!activeChar) return;
        const nextItems = await removeItemFromCharacter(activeChar.id, payload.item.id);
        setItems(nextItems);
        engineRef.current?.syncHeroAppearance(
          activeChar.classType,
          nextItems.filter((i) => i.isEquipped),
        );

        await recordSharedLedger({
          id: payload.tradeId,
          sessionId: payload.sessionCode,
          transportMode: payload.transport,
          partnerName: payload.toPeerName,
          role: payload.toRole === 'host' ? 'guest' : 'host',
          direction: 'sent',
          itemId: payload.item.id,
          itemName: `${payload.item.name} +${payload.item.enhanceLevel}`,
          itemSnapshotJson: JSON.stringify(payload.item),
          status: 'committed',
          createdAt: payload.timestamp,
        });
        setLedger(await getSharedLedger());
        soundSynth.playTradeSync();
        setSyncMessage(`Transferido ${payload.item.name} +${payload.item.enhanceLevel} a ${payload.toPeerName}. Historial SQLite actualizado.`);
      },
      onRoomEnded: async (message) => {
        setRoomState(null);
        engineRef.current?.setEventActive(false);
        engineRef.current?.syncRemotePeers([], syncRef.current?.peerId || '');
        setSyncMessage(message);
        pushBanner('Invitación finalizada · Ítems asegurados en SQLite', '#fbbf24');
      },
      onError: (message) => {
        setSyncMessage(message);
      },
    });
    syncRef.current = manager;
    return () => {
      manager.disconnect();
    };
  }, [pushBanner]);

  // Mount Three.js WebGL Engine once in isolated ref container
  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const callbacks: EngineCallbacks = {
      onKillMonster: async (xp, zen) => {
        const c = charRef.current;
        if (!c) return;
        let nextXp = c.xp + xp;
        let nextLevel = c.level;
        let nextXpToNext = c.xpToNext;
        let nextMaxHp = c.maxHp;
        let nextMaxMp = c.maxMp;
        let str = c.str;
        let agi = c.agi;
        let vit = c.vit;
        let ene = c.ene;

        while (nextXp >= nextXpToNext) {
          nextXp -= nextXpToNext;
          nextLevel += 1;
          nextXpToNext = Math.round(nextXpToNext * 1.25);
          nextMaxHp += 24;
          nextMaxMp += 14;
          if (c.classType === 'DK') { str += 3; vit += 2; }
          else if (c.classType === 'DW') { ene += 4; agi += 1; }
          else { agi += 3; ene += 2; }
          pushBanner(`¡Subiste a Nivel ${nextLevel}!`, '#fbbf24');
        }

        const updated: MuCharacter = {
          ...c,
          level: nextLevel,
          xp: nextXp,
          xpToNext: nextXpToNext,
          maxHp: nextMaxHp,
          hp: nextMaxHp,
          maxMp: nextMaxMp,
          mp: nextMaxMp,
          str,
          agi,
          vit,
          ene,
          zen: c.zen + zen,
          kills: c.kills + 1,
        };
        setCharacter(updated);
        await updateCharacter(updated);
      },
      onPickupLoot: async (drop) => {
        const c = charRef.current;
        if (!c) return;
        const updated: MuCharacter = {
          ...c,
          zen: c.zen + (drop.kind === 'zen' ? drop.amount : 0),
          bless: c.bless + (drop.kind === 'bless' ? drop.amount : 0),
          soul: c.soul + (drop.kind === 'soul' ? drop.amount : 0),
        };
        setCharacter(updated);
        await updateCharacter(updated);
        pushBanner(`+${drop.label}`, drop.kind === 'bless' ? '#f87171' : drop.kind === 'soul' ? '#60a5fa' : '#fbbf24');
      },
      onPlayerDamaged: async (amount) => {
        const c = charRef.current;
        if (!c) return;
        const nextHp = Math.max(15, c.hp - amount);
        const updated = { ...c, hp: nextHp };
        setCharacter(updated);
      },
      onHeroMoveSync: (x, z, rotY, action) => {
        if (roomRef.current && syncRef.current) {
          syncRef.current.sendPeerUpdate({ x, z, rotY, action });
        }
      },
      onBossHitInEvent: (damage) => {
        syncRef.current?.damageBoss(damage, charRef.current?.name || 'Héroe');
      },
      onFloatingText: (text, color) => {
        pushBanner(text, color);
      },
    };

    const engine = new MuWorldEngine(mount, callbacks);
    engineRef.current = engine;

    if (charRef.current) {
      engine.syncHeroAppearance(
        charRef.current.classType,
        itemsRef.current.filter((i) => i.isEquipped),
      );
    }

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [pushBanner]);

  const handleStartGame = useCallback(async () => {
    const hero = await createOrSelectClassHero(heroNameInput, selectedClass);
    await loadAllFromSqlite(hero.id);
    engineRef.current?.setMode('playing');
    setGameState('playing');
  }, [heroNameInput, selectedClass, loadAllFromSqlite]);

  // Global keyboard shortcuts for Title / Pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      if (gameState === 'title' && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        handleStartGame();
      } else if (e.code === 'Escape') {
        if (activeDrawer !== 'none') {
          setActiveDrawer('none');
        } else if (gameState === 'playing') {
          setGameState('paused');
        } else if (gameState === 'paused') {
          setGameState('playing');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gameState, activeDrawer, handleStartGame]);

  const buildPeerSnapshot = (): RoomPeer => {
    const c = character!;
    const eqWeapon = items.find((i) => i.slot === 'weapon' && i.isEquipped);
    const eqArmor = items.find((i) => i.slot === 'armor' && i.isEquipped);
    return {
      peerId: syncRef.current?.peerId || 'peer-local',
      name: c.name,
      classType: c.classType,
      level: c.level,
      role: 'host',
      transport: 'wifi',
      x: 0,
      z: 6,
      rotY: Math.PI,
      action: 'idle',
      equippedSet: eqArmor?.setName || 'Básico',
      equippedWeapon: eqWeapon?.name || 'Espada',
      enhanceLevel: eqWeapon?.enhanceLevel ?? 5,
    };
  };

  const handleEquip = async (itemId: string) => {
    if (!character) return;
    const nextItems = await equipItem(character.id, itemId);
    setItems(nextItems);
    engineRef.current?.syncHeroAppearance(
      character.classType,
      nextItems.filter((i) => i.isEquipped),
    );
    soundSynth.playForge(true);
    setForgeMessage('Equipo actualizado y guardado en SQLite.');
  };

  const handleUpgrade = async (itemId: string, jewel: 'bless' | 'soul') => {
    if (!character) return;
    const result = await upgradeItemWithJewel(character, itemId, jewel);
    setCharacter(result.character);
    setItems(result.items);
    setForgeMessage(result.message);
    soundSynth.playForge(result.success);
    engineRef.current?.syncHeroAppearance(
      result.character.classType,
      result.items.filter((i) => i.isEquipped),
    );
  };

  const toggleMute = () => {
    soundSynth.muted = !muted;
    setMuted(!muted);
  };

  const handleHealPotion = async () => {
    if (!character) return;
    const updated = { ...character, hp: character.maxHp, mp: character.maxMp };
    setCharacter(updated);
    await updateCharacter(updated);
    pushBanner('HP y MP restaurados', '#4ade80');
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0c1018]">
      {/* Isolated 3D WebGL Canvas Mount */}
      <div ref={canvasMountRef} className="absolute inset-0 w-full h-full" />

      <OfflineIndicator />

      {/* TITLE SCREEN OVERLAY */}
      {gameState === 'title' && (
        <div className="absolute inset-0 z-20 flex flex-col justify-between p-6 md:p-10 bg-gradient-to-r from-[#0c1018]/92 via-[#0c1018]/65 to-transparent">
          <div className="flex items-center justify-between gap-4">
            <div className="text-xs text-slate-300 font-mono-tabular">
              SQLite Integrado · Wi-Fi y Bluetooth Local
            </div>
            <PWAInstallButton onOpenApkCenter={() => setActiveDrawer('apk')} />
          </div>

          <div className="max-w-xl space-y-6 my-auto">
            {/* Bespoke SVG Title Lockup */}
            <div>
              <svg
                viewBox="0 0 520 112"
                className="w-full max-w-[440px] h-auto"
                role="img"
                aria-label="MU Lorencia Offline"
              >
                <defs>
                  <linearGradient id="muTitleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#fef3c7" />
                    <stop offset="50%" stopColor="#f59e0b" />
                    <stop offset="100%" stopColor="#b45309" />
                  </linearGradient>
                </defs>
                <path
                  d="M8 22 L46 22 L54 10 L62 22 L100 22"
                  fill="none"
                  stroke="#d97706"
                  strokeWidth="2"
                  opacity="0.7"
                />
                <text
                  x="6"
                  y="72"
                  fill="url(#muTitleGrad)"
                  fontFamily="Cinzel, Georgia, serif"
                  fontWeight="700"
                  fontSize="46"
                  letterSpacing="3"
                >
                  MU LORENCIA
                </text>
                <text
                  x="8"
                  y="100"
                  fill="#cbd5e1"
                  fontFamily="Plus Jakarta Sans, sans-serif"
                  fontWeight="600"
                  fontSize="15"
                  letterSpacing="5"
                >
                  OFFLINE · SQLITE · SYNC LOCAL
                </text>
              </svg>
              <p className="text-sm text-slate-300 mt-2 max-w-md leading-relaxed">
                Explora Lorencia en 3D sin conexión, forja tu set hasta +13 en tu base SQLite y conéctate por Wi-Fi o Bluetooth para compartir armas y eventos sin perder nada.
              </p>
            </div>

            {/* Class Picker & Hero Name */}
            <div className="space-y-3 bg-[#101521]/92 border border-slate-700/80 rounded-xl p-4">
              <div className="grid grid-cols-3 gap-2">
                {CLASS_INFO.map((cls) => (
                  <button
                    key={cls.id}
                    onClick={() => {
                      setSelectedClass(cls.id);
                      const existing = characters.find((c) => c.classType === cls.id);
                      if (existing) {
                        setHeroNameInput(existing.name);
                        engineRef.current?.syncHeroAppearance(cls.id, []);
                      } else {
                        setHeroNameInput(
                          cls.id === 'DK'
                            ? 'GuerreroLorencia'
                            : cls.id === 'DW'
                              ? 'MagoLorencia'
                              : 'ElfaLorencia',
                        );
                        engineRef.current?.syncHeroAppearance(cls.id, []);
                      }
                    }}
                    className={`min-h-[54px] p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                      selectedClass === cls.id
                        ? 'bg-amber-600/20 border-amber-500 text-amber-200'
                        : 'bg-[#151c2c] border-slate-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <div className="text-xs font-bold whitespace-nowrap truncate">{cls.title}</div>
                    <div className="text-[11px] text-slate-400 truncate mt-0.5">{cls.subtitle}</div>
                  </button>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="text"
                  value={heroNameInput}
                  onChange={(e) => setHeroNameInput(e.target.value)}
                  placeholder="Nombre del Héroe"
                  maxLength={18}
                  className="flex-1 min-h-[46px] rounded-lg bg-[#0b0f18] border border-slate-700 px-3.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                />
                <button
                  onClick={handleStartGame}
                  className="min-h-[46px] px-6 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-sm inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  Entrar al Mundo
                </button>
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-400 font-mono-tabular">
            WASD Mover · Espacio Atacar · 1-3 Habilidades · E Recoger · Esc Pausa
          </div>
        </div>
      )}

      {/* PLAYING HUD (>= 85% Unobstructed Playfield, No backdrop-filter over WebGL) */}
      {gameState !== 'title' && character && (
        <>
          {/* Top-Left Hero Status Cluster */}
          <div className="pointer-events-none fixed top-3 left-3 z-20 flex flex-col gap-2 max-w-[280px]">
            <div className="rounded-xl bg-[#0e131d]/92 border border-slate-700/80 px-3.5 py-2.5 shadow-lg">
              <div className="flex items-center justify-between gap-3">
                <span className="font-display text-sm font-bold text-amber-300 truncate">
                  {character.name}
                </span>
                <span className="text-xs font-mono-tabular text-slate-300 whitespace-nowrap shrink-0">
                  {character.classType} · Nv.{character.level}
                </span>
              </div>

              {/* HP & MP Bars */}
              <div className="mt-2 space-y-1.5">
                <div className="h-2 w-full rounded bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-rose-600 transition-all"
                    style={{ width: `${Math.round((character.hp / character.maxHp) * 100)}%` }}
                  />
                </div>
                <div className="h-1.5 w-full rounded bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-sky-500 transition-all"
                    style={{ width: `${Math.round((character.mp / character.maxMp) * 100)}%` }}
                  />
                </div>
              </div>

              <div className="mt-2 flex items-center gap-2 text-[11px] font-mono-tabular text-slate-300">
                <span>Zen {character.zen.toLocaleString()}</span>
                <span>·</span>
                <span className="text-rose-300">Bless {character.bless}</span>
                <span>·</span>
                <span className="text-sky-300">Soul {character.soul}</span>
              </div>
            </div>

            {roomState && (
              <div className="rounded-lg bg-[#0e131d]/92 border border-sky-500/40 px-3 py-1.5 text-xs font-mono-tabular text-sky-200 flex items-center gap-2">
                {roomState.transport === 'wifi' ? (
                  <Wifi className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                ) : (
                  <Bluetooth className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                )}
                <span>
                  Sala {roomState.code} · {roomState.peers.length} en línea
                </span>
              </div>
            )}
          </div>

          {/* Top-Center Active Event Boss HP Bar */}
          {roomState?.activeEvent && (
            <div className="pointer-events-none fixed top-3 left-1/2 -translate-x-1/2 z-20 w-[min(360px,72vw)] rounded-xl bg-[#1a1014]/95 border border-rose-500/50 px-4 py-2 shadow-xl">
              <div className="flex items-center justify-between text-xs font-semibold text-rose-200">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                  Jefe de Evento · Oleada {roomState.eventWave}
                </span>
                <span className="font-mono-tabular">
                  {roomState.bossHp} / {roomState.bossMaxHp}
                </span>
              </div>
              <div className="mt-1.5 h-2.5 w-full rounded bg-slate-900 overflow-hidden">
                <div
                  className="h-full bg-rose-500 transition-all"
                  style={{ width: `${Math.round((roomState.bossHp / roomState.bossMaxHp) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Top-Right Compact Controls */}
          <div className="fixed top-3 right-3 z-20 flex items-center gap-2">
            <button
              onClick={() => setShowTouchPad((v) => !v)}
              className="min-h-[44px] px-3 rounded-lg bg-[#0e131d]/92 border border-slate-700 text-xs font-medium text-slate-200 hover:border-amber-500/60 hidden sm:inline-flex items-center cursor-pointer"
            >
              {showTouchPad ? 'Ocultar Pad' : 'Pad Táctil'}
            </button>
            <button
              onClick={toggleMute}
              aria-label={muted ? 'Activar audio' : 'Silenciar audio'}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-[#0e131d]/92 border border-slate-700 text-slate-200 hover:border-amber-500/60 cursor-pointer"
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setGameState(gameState === 'playing' ? 'paused' : 'playing')}
              aria-label="Pausa"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-[#0e131d]/92 border border-slate-700 text-slate-200 hover:border-amber-500/60 cursor-pointer"
            >
              <Pause className="w-4 h-4" />
            </button>
          </div>

          {/* Floating Combat / Loot Feedback */}
          <div className="pointer-events-none fixed top-24 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1">
            {banners.map((b) => (
              <div
                key={b.id}
                style={{ color: b.color }}
                className="px-3 py-1 rounded bg-[#0c1018]/85 text-xs font-bold font-mono-tabular shadow"
              >
                {b.text}
              </div>
            ))}
          </div>

          {/* Mobile Touch Controls (Thumb Zones) */}
          {showTouchPad && gameState === 'playing' && (
            <>
              {/* Left Thumb D-Pad */}
              <div className="fixed bottom-24 left-4 z-20 grid grid-cols-3 gap-1 w-36 h-36">
                <div />
                <button
                  onPointerDown={() => engineRef.current?.setJoystickVector(0, -1)}
                  onPointerUp={() => engineRef.current?.setJoystickVector(0, 0)}
                  onPointerLeave={() => engineRef.current?.setJoystickVector(0, 0)}
                  className="rounded-lg bg-[#111723]/85 border border-slate-600/80 text-slate-200 text-xs font-bold active:bg-amber-600"
                >
                  ▲
                </button>
                <div />
                <button
                  onPointerDown={() => engineRef.current?.setJoystickVector(-1, 0)}
                  onPointerUp={() => engineRef.current?.setJoystickVector(0, 0)}
                  onPointerLeave={() => engineRef.current?.setJoystickVector(0, 0)}
                  className="rounded-lg bg-[#111723]/85 border border-slate-600/80 text-slate-200 text-xs font-bold active:bg-amber-600"
                >
                  ◀
                </button>
                <button
                  onClick={() => engineRef.current?.pickupNearestLoot()}
                  className="rounded-lg bg-amber-600/90 text-slate-950 text-[10px] font-bold"
                >
                  E
                </button>
                <button
                  onPointerDown={() => engineRef.current?.setJoystickVector(1, 0)}
                  onPointerUp={() => engineRef.current?.setJoystickVector(0, 0)}
                  onPointerLeave={() => engineRef.current?.setJoystickVector(0, 0)}
                  className="rounded-lg bg-[#111723]/85 border border-slate-600/80 text-slate-200 text-xs font-bold active:bg-amber-600"
                >
                  ▶
                </button>
                <div />
                <button
                  onPointerDown={() => engineRef.current?.setJoystickVector(0, 1)}
                  onPointerUp={() => engineRef.current?.setJoystickVector(0, 0)}
                  onPointerLeave={() => engineRef.current?.setJoystickVector(0, 0)}
                  className="rounded-lg bg-[#111723]/85 border border-slate-600/80 text-slate-200 text-xs font-bold active:bg-amber-600"
                >
                  ▼
                </button>
                <div />
              </div>

              {/* Right Thumb Combat Cluster */}
              <div className="fixed bottom-24 right-4 z-20 flex flex-col items-end gap-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => engineRef.current?.triggerSkill(1)}
                    className="w-12 h-12 rounded-xl bg-[#182133]/90 border border-rose-500/60 text-rose-200 text-xs font-bold active:scale-95"
                  >
                    1
                  </button>
                  <button
                    onClick={() => engineRef.current?.triggerSkill(2)}
                    className="w-12 h-12 rounded-xl bg-[#182133]/90 border border-sky-500/60 text-sky-200 text-xs font-bold active:scale-95"
                  >
                    2
                  </button>
                </div>
                <button
                  onClick={() => engineRef.current?.triggerBasicAttack()}
                  className="w-16 h-16 rounded-2xl bg-amber-600 border-2 border-amber-300 text-slate-950 font-bold text-xs flex flex-col items-center justify-center shadow-lg active:scale-95"
                >
                  <Sword className="w-5 h-5" />
                  Atacar
                </button>
              </div>
            </>
          )}

          {/* Unified Collapsible Bottom Control Dock */}
          <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center max-w-[96vw]">
            <button
              onClick={() => setDockCollapsed((c) => !c)}
              className="px-3 py-1 rounded-t-lg bg-[#0e131d]/95 border border-b-0 border-slate-700 text-[11px] font-medium text-slate-300 inline-flex items-center gap-1 cursor-pointer"
            >
              {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {dockCollapsed ? 'Mostrar Barra' : 'Ocultar Barra'}
            </button>

            {!dockCollapsed && (
              <div className="flex items-center gap-1.5 sm:gap-2 px-3 py-2 rounded-xl bg-[#0e131d]/95 border border-slate-700/90 shadow-2xl overflow-x-auto max-w-[96vw]">
                {/* Combat Skills */}
                <button
                  onClick={() => engineRef.current?.triggerBasicAttack()}
                  className="min-h-[44px] px-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Sword className="w-4 h-4" />
                  Atacar
                </button>
                <button
                  onClick={() => engineRef.current?.triggerSkill(1)}
                  className="min-h-[44px] px-2.5 rounded-lg bg-[#192233] hover:bg-slate-700 text-rose-300 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  [1] Tajo
                </button>
                <button
                  onClick={() => engineRef.current?.triggerSkill(2)}
                  className="min-h-[44px] px-2.5 rounded-lg bg-[#192233] hover:bg-slate-700 text-sky-300 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  [2] Espiral
                </button>
                <button
                  onClick={handleHealPotion}
                  className="min-h-[44px] px-2.5 rounded-lg bg-[#192233] hover:bg-slate-700 text-emerald-300 text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Poción
                </button>

                <div className="h-6 w-px bg-slate-700 mx-0.5 shrink-0" />

                {/* Core Management Drawers */}
                <button
                  onClick={() => setActiveDrawer('inventory')}
                  className="min-h-[44px] px-3 rounded-lg bg-[#171f2f] hover:bg-slate-700 text-slate-100 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Backpack className="w-4 h-4 text-amber-400" />
                  Inventario
                </button>
                <button
                  onClick={() => setActiveDrawer('sync')}
                  className="min-h-[44px] px-3 rounded-lg bg-[#171f2f] hover:bg-slate-700 text-slate-100 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Wifi className="w-4 h-4 text-sky-400" />
                  Wi-Fi / BT
                </button>
                <button
                  onClick={() => setActiveDrawer('oracle')}
                  className="min-h-[44px] px-3 rounded-lg bg-[#171f2f] hover:bg-slate-700 text-slate-100 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Bot className="w-4 h-4 text-emerald-400" />
                  Oráculo IA
                </button>
                <button
                  onClick={() => setActiveDrawer('apk')}
                  className="min-h-[44px] px-3 rounded-lg bg-[#171f2f] hover:bg-slate-700 text-slate-100 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Smartphone className="w-4 h-4 text-amber-300" />
                  APK / SQLite
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* PAUSE MODAL */}
      {gameState === 'paused' && activeDrawer === 'none' && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[#111622] border border-slate-700 p-6 space-y-3 shadow-2xl">
            <h2 className="font-display text-xl font-bold text-amber-300 text-center">
              Juego en Pausa
            </h2>
            <p className="text-xs text-slate-400 text-center">
              Todo tu progreso y los intercambios están guardados en SQLite local.
            </p>
            <button
              onClick={() => setGameState('playing')}
              className="w-full min-h-[44px] rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-sm cursor-pointer"
            >
              Continuar Aventura
            </button>
            <button
              onClick={() => setActiveDrawer('sync')}
              className="w-full min-h-[44px] rounded-lg bg-[#192233] hover:bg-slate-700 text-slate-100 font-semibold text-sm cursor-pointer"
            >
              Vinculación Wi-Fi y Bluetooth
            </button>
            <button
              onClick={() => setActiveDrawer('apk')}
              className="w-full min-h-[44px] rounded-lg bg-[#192233] hover:bg-slate-700 text-slate-100 font-semibold text-sm cursor-pointer"
            >
              APK Móvil y Respaldo SQLite
            </button>
            <button
              onClick={() => {
                engineRef.current?.setMode('title');
                setGameState('title');
              }}
              className="w-full min-h-[44px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-sm cursor-pointer"
            >
              Volver a Pantalla Principal
            </button>
          </div>
        </div>
      )}

      {/* FEATURE DRAWERS */}
      {character && (
        <>
          <InventoryDrawer
            open={activeDrawer === 'inventory'}
            character={character}
            items={items}
            onClose={() => {
              setActiveDrawer('none');
              setForgeMessage(null);
            }}
            onEquip={handleEquip}
            onUpgrade={handleUpgrade}
            forgeMessage={forgeMessage}
          />

          <SyncLinkDrawer
            open={activeDrawer === 'sync'}
            character={character}
            items={items}
            localPeerId={syncRef.current?.peerId || 'peer-local'}
            wsConnected={wsConnected}
            roomState={roomState}
            bluetoothDeviceName={btDeviceName}
            ledger={ledger}
            eventHistory={eventHistory}
            statusMessage={syncMessage}
            onClose={() => setActiveDrawer('none')}
            onPairBluetooth={async () => {
              if (!syncRef.current) return;
              const res = await syncRef.current.pairBluetoothHardware();
              if (res.deviceName) setBtDeviceName(res.deviceName);
              setSyncMessage(res.message);
            }}
            onCreateRoom={async (evType, trans) => {
              if (!syncRef.current) return;
              await syncRef.current.createRoom(buildPeerSnapshot(), evType, trans);
              setSyncMessage('Sala creada. Comparte el código o enlace con los invitados.');
            }}
            onJoinRoom={async (code, trans) => {
              if (!syncRef.current) return;
              await syncRef.current.joinRoom(code, buildPeerSnapshot(), trans);
            }}
            onStartEvent={(evType) => {
              syncRef.current?.startEvent(evType);
              setActiveDrawer('none');
            }}
            onSendItemToPeer={(targetPeerId, item) => {
              syncRef.current?.sendTradeItem(targetPeerId, item);
            }}
            onEndRoom={() => {
              syncRef.current?.endRoom();
            }}
          />

          <OracleChatDrawer
            open={activeDrawer === 'oracle'}
            character={character}
            items={items}
            ledgerCount={ledger.length}
            messages={chatMessages}
            onClose={() => setActiveDrawer('none')}
            onAddMessages={async (u, m) => {
              await saveChatMessage(u);
              await saveChatMessage(m);
              setChatMessages(await getChatHistory());
            }}
          />
        </>
      )}

      <ApkSyncDrawer
        open={activeDrawer === 'apk'}
        onClose={() => setActiveDrawer('none')}
        onDatabaseImported={async () => {
          await loadAllFromSqlite();
        }}
      />
    </div>
  );
}
