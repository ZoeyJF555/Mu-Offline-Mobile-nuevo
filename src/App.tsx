import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bluetooth, RotateCw, ShieldAlert, Wifi } from 'lucide-react';
import {
  DEFAULT_BUTTON_LAYOUTS,
  MU_SKILLS,
  getStarterItemsForMuClass,
  getDefaultComboConfig,
} from './data/muSkillsAndClasses';
import { getMapById } from './data/muWorldData';
import {
  addItemToCharacter,
  allocateStatPoint,
  buyJewelFromNpc,
  buyShopItem,
  changeAccountPassword,
  createCharacterForAccount,
  equipItem,
  executeChaosMixWing,
  getChatHistory,
  getEventSessions,
  getItemsForCharacter,
  getLocalRecoveryQuestions,
  getSharedLedger,
  initDexie,
  listAccounts,
  listCharactersByAccount,
  loadButtonLayouts,
  loadComboConfig,
  loadGameSettings,
  loginAccount,
  recordSharedLedger,
  recoverAccountLocal,
  registerAccount,
  removeItemFromCharacter,
  saveButtonLayouts,
  saveChatMessage,
  saveComboConfig,
  saveGameSettings,
  wearEquipment,
  repairEquipment,
  sellInventoryItem,
  updateCharacter,
  upgradeItemWithJewel,
  upsertEventSession,
} from './db/dexieStore';
import { MuWorldEngine, type EngineCallbacks } from './game/MuWorldEngine';
import { soundSynth } from './game/soundSynth';
import { cloudSyncManager } from './services/cloudSyncManager';
import { LocalSyncManager } from './services/syncManager';
import { ApkSyncDrawer } from './components/ApkSyncDrawer';
import { CharacterStatsModal } from './components/CharacterStatsModal';
import { ClassicLoginFlow } from './components/ClassicLoginFlow';
import { MapWarpModal } from './components/MapWarpModal';
import { MuHudOverlay, type WorldTelemetryInfo } from './components/MuHudOverlay';
import { MuInventoryModal } from './components/MuInventoryModal';
import { NpcShopModal } from './components/NpcShopModal';
import { OracleChatDrawer } from './components/OracleChatDrawer';
import { OfflineIndicator } from './components/PWAInstallButton';
import { SettingsModal } from './components/SettingsModal';
import { SyncLinkDrawer } from './components/SyncLinkDrawer';
import type {
  ButtonLayoutItem,
  CharacterComboConfig,
  ChatMessageRecord,
  EventSessionRecord,
  FloatingDamageNumber,
  GameSettings,
  HeroClass,
  HudButtonId,
  MapId,
  MuAccount,
  MuCharacter,
  MuItem,
  NpcDef,
  RoomPeer,
  RoomState,
  SharedLedgerEntry,
  ShopItemDef,
  SkillDef,
  SyncStatusInfo,
} from './types/game';

interface FloatingBanner {
  id: number;
  text: string;
  color: string;
}

const INITIAL_SETTINGS: GameSettings = {
  brightness: 1.08,
  volume: 0.75,
  muted: false,
  musicEnabled: true,
  musicVolume: 0.45,
  free3dCamera: false,
  targetFps: 60,
};

export default function App() {
  const worldLoadRef = useRef(false);
  const [worldLoading,setWorldLoading] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<MuWorldEngine | null>(null);
  const syncRef = useRef<LocalSyncManager | null>(null);

  const [screenStage, setScreenStage] = useState<'login' | 'character_select' | 'playing' | 'paused'>('login');
  const [accounts, setAccounts] = useState<MuAccount[]>([]);
  const [currentAccount, setCurrentAccount] = useState<MuAccount | null>(null);
  const [characters, setCharacters] = useState<MuCharacter[]>([]);
  const [character, setCharacter] = useState<MuCharacter | null>(null);
  const [items, setItems] = useState<MuItem[]>([]);
  const [ledger, setLedger] = useState<SharedLedgerEntry[]>([]);
  const [eventHistory, setEventHistory] = useState<EventSessionRecord[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessageRecord[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatusInfo>(() => cloudSyncManager.getStatus());

  const [gameSettings, setGameSettings] = useState<GameSettings>(INITIAL_SETTINGS);
  const [buttonLayouts, setButtonLayouts] = useState<Record<HudButtonId, ButtonLayoutItem>>(DEFAULT_BUTTON_LAYOUTS);
  const [comboConfig, setComboConfig] = useState<CharacterComboConfig>(getDefaultComboConfig('DK'));
  const [comboArmed, setComboArmed] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [measuredFps, setMeasuredFps] = useState(60);
  const [worldTelemetry, setWorldTelemetry] = useState<WorldTelemetryInfo>({
    x: 0,
    z: 8,
    inSafeCity: true,
    totalMonsters: 24000,
    nearbyMonsters: 0,
    mapName: 'Lorencia',
    areaKm2: 1.0,
  });
  const [damageNumbers, setDamageNumbers] = useState<FloatingDamageNumber[]>([]);
  const [isPortraitMobile, setIsPortraitMobile] = useState(
    () => typeof window !== 'undefined' && window.innerHeight > window.innerWidth && window.innerWidth < 900,
  );

  const [activeDrawer, setActiveDrawer] = useState<
    'none' | 'inventory' | 'sync' | 'oracle' | 'apk' | 'settings' | 'mapWarp' | 'stats' | 'npc'
  >('none');
  const [nearbyNpc, setNearbyNpc] = useState<NpcDef | null>(null);
  const [activeNpc, setActiveNpc] = useState<NpcDef | null>(null);
  const [npcStatusMessage, setNpcStatusMessage] = useState<string | null>(null);
  const [forgeMessage, setForgeMessage] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [btDeviceName, setBtDeviceName] = useState<string | null>(null);
  const [banners, setBanners] = useState<FloatingBanner[]>([]);

  const charRef = useRef<MuCharacter | null>(null);
  const itemsRef = useRef<MuItem[]>([]);
  const roomRef = useRef<RoomState | null>(null);
  const settingsRef = useRef<GameSettings>(INITIAL_SETTINGS);
  const screenStageRef = useRef(screenStage);
  const currentAccRef = useRef<MuAccount | null>(null);
  charRef.current = character;
  itemsRef.current = items;
  roomRef.current = roomState;
  settingsRef.current = gameSettings;
  screenStageRef.current = screenStage;
  currentAccRef.current = currentAccount;

  const pushBanner = useCallback((text: string, color = '#fbbf24') => {
    const id = Date.now() + Math.random();
    setBanners((prev) => [...prev.slice(-3), { id, text, color }]);
    window.setTimeout(() => {
      setBanners((prev) => prev.filter((b) => b.id !== id));
    }, 2200);
  }, []);

  const pushDamageNumber = useCallback((dmg: FloatingDamageNumber) => {
    setDamageNumbers((prev) => [...prev.slice(-14), dmg]);
    window.setTimeout(() => {
      setDamageNumbers((prev) => prev.filter((d) => d.id !== dmg.id));
    }, 950);
  }, []);

  const requestLandscapeFullscreen = useCallback(async () => {
    try {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      const orient = screen.orientation as unknown as { lock?: (o: string) => Promise<void> };
      if (orient?.lock) {
        await orient.lock('landscape');
      }
    } catch {
      // Ignore browser orientation lock restrictions
    }
  }, []);

  useEffect(() => {
    const checkOrient = () => {
      setIsPortraitMobile(window.innerHeight > window.innerWidth && window.innerWidth < 900);
    };
    window.addEventListener('resize', checkOrient);
    return () => window.removeEventListener('resize', checkOrient);
  }, []);

  // Unlock Web Audio on first gesture so background music starts smoothly
  useEffect(() => {
    const unlock = () => {
      soundSynth.unlockAudio();
      void engineRef.current?.unlockAudio();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const selectAndHydrateCharacter = useCallback(async (charObj: MuCharacter) => {
    setCharacter(charObj);
    engineRef.current?.updateHeroStats(charObj);
    const [charItems, charCombo] = await Promise.all([
      getItemsForCharacter(charObj.id),
      loadComboConfig(charObj.id, charObj.classType),
    ]);
    setItems(charItems);
    setComboConfig(charCombo);
    engineRef.current?.syncHeroAppearance(
      charObj.classType,
      charItems.filter((i) => i.isEquipped),
      charObj.sex,
    ).catch(console.error);
  }, []);

  const loadAllFromDexie = useCallback(
    async (preferAccountId?: string, preferCharId?: string) => {
      await initDexie();
      const [accList, loadedSettings, loadedLayouts, led, evs, chats] = await Promise.all([
        listAccounts(),
        loadGameSettings(),
        loadButtonLayouts(),
        getSharedLedger(),
        getEventSessions(),
        getChatHistory(),
      ]);

      setAccounts(accList);
      setGameSettings(loadedSettings);
      setButtonLayouts(loadedLayouts);
      setLedger(led);
      setEventHistory(evs);
      setChatMessages(chats);

      const activeAccId = preferAccountId || currentAccRef.current?.id || accList[0]?.id;
      if (activeAccId) {
        const chars = await listCharactersByAccount(activeAccId);
        setCharacters(chars);
        const chosen = (preferCharId && chars.find((c) => c.id === preferCharId)) || chars[0] || null;
        if (chosen) {
          await selectAndHydrateCharacter(chosen);
        } else {
          setCharacter(null);
          engineRef.current?.updateHeroStats(null);
          setItems([]);
        }
      }
    },
    [selectAndHydrateCharacter],
  );

  // Sync engine hero stats snapshot whenever character changes
  useEffect(() => {
    engineRef.current?.updateHeroStats(character);
  }, [character]);

  // Boot Dexie IndexedDB & CloudSyncManager (Golden Rule timestamp sync)
  useEffect(() => {
    let unsubStatus = () => {};
    let unsubCloudApplied = () => {};

    loadAllFromDexie().then(() => {
      cloudSyncManager.start();
      unsubStatus = cloudSyncManager.subscribeStatus((st) => {
        setSyncStatus(st);
      });
      unsubCloudApplied = cloudSyncManager.onCloudDataApplied(() => {
        loadAllFromDexie(currentAccRef.current?.id, charRef.current?.id);
      });
    });

    const params = new URLSearchParams(window.location.search);
    if (params.get('sala')) {
      setActiveDrawer('sync');
    }

    return () => {
      unsubStatus();
      unsubCloudApplied();
      cloudSyncManager.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    soundSynth.volume = gameSettings.volume;
    soundSynth.muted = gameSettings.muted;
    engineRef.current?.setAudio(gameSettings.volume, gameSettings.muted);
    soundSynth.setMusicConfig(gameSettings.musicEnabled, gameSettings.musicVolume);
    engineRef.current?.setBrightness(gameSettings.brightness);
    engineRef.current?.setFree3dMode(gameSettings.free3dCamera);
    engineRef.current?.setTargetFps(gameSettings.targetFps);
  }, [gameSettings]);

  // Passive MU SD / MP / AG regeneration while playing
  useEffect(() => {
    if (screenStage !== 'playing') return;
    const timer = window.setInterval(() => {
      setCharacter((prev) => {
        if (!prev) return prev;
        if (prev.mp >= prev.maxMp && prev.ag >= prev.maxAg && prev.sd >= prev.maxSd) return prev;
        return {
          ...prev,
          mp: Math.min(prev.maxMp, prev.mp + 6),
          ag: Math.min(prev.maxAg, prev.ag + 8),
          sd: Math.min(prev.maxSd, prev.sd + 5),
        };
      });
    }, 1100);
    return () => window.clearInterval(timer);
  }, [screenStage]);

  useEffect(() => {
    const manager = new LocalSyncManager({
      onConnectionChange: (connected) => setWsConnected(connected),
      onRoomState: (room) => {
        setRoomState(room);
        engineRef.current?.setEventActive(room.activeEvent, room.eventType);
        if (syncRef.current) {
          engineRef.current?.syncRemotePeers(room.peers, syncRef.current.peerId).catch(console.error);
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
            engineRef.current?.syncRemotePeers(peers, syncRef.current.peerId).catch(console.error);
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
          const savedChar = await updateCharacter(updated);
          setCharacter(savedChar);

          const rewardItem: MuItem = {
            id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            charId: savedChar.id,
            name: reward.itemName,
            slot: reward.itemName.includes('Báculo') || reward.itemName.includes('Espada') ? 'weapon' : 'armor',
            category:
              reward.itemName.includes('Alas')
                ? 'wings'
                : reward.itemName.includes('Báculo') || reward.itemName.includes('Espada')
                  ? 'weapon'
                  : 'armor',
            setName: 'Evento Cooperativo',
            rarity: 'excellent',
            enhanceLevel: 7,
            minDmg: 54,
            maxDmg: 82,
            defense: 42,
            magicPower: 68,
            luck: true,
            excellentOpt: 'Recompensa de Evento Guardada en IndexedDB',
            isEquipped: false,
            originalOwner: room.hostName,
            sharedFromSession: room.code,
            acquiredAt: new Date().toISOString(),
          };
          const nextItems = await addItemToCharacter(savedChar.id, rewardItem);
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
        pushBanner(`¡Evento completado! Recibido ${reward.itemName} +7`, '#34d399');
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
        setSyncMessage(
          `Recibiste ${incomingItem.name} +${incomingItem.enhanceLevel} de ${payload.fromPeerName}. Guardado en IndexedDB.`,
        );
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
          activeChar.sex,
        ).catch(console.error);

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
        setSyncMessage(
          `Transferido ${payload.item.name} +${payload.item.enhanceLevel} a ${payload.toPeerName}. Guardado en IndexedDB.`,
        );
      },
      onRoomEnded: async (message) => {
        setRoomState(null);
        engineRef.current?.setEventActive(false);
        engineRef.current?.syncRemotePeers([], syncRef.current?.peerId || '');
        setSyncMessage(message);
        pushBanner('Invitación finalizada · Ítems asegurados en IndexedDB', '#fbbf24');
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

  // Mount Babylon.js Web3D Engine once
  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const callbacks: EngineCallbacks = {
      onEquipmentWear: (slot, durability) => {
        const char = charRef.current; if (!char) return;
        const next = itemsRef.current.map(i => i.isEquipped && i.slot === slot ? { ...i, durability } : i);
        itemsRef.current = next; setItems(next);
        setCharacter(prev => prev?.id === char.id ? { ...prev, equipment: next.filter(i=>i.isEquipped), inventory: next.filter(i=>!i.isEquipped) } : prev);
        void wearEquipment(char.id, slot, durability, next.find(i => i.isEquipped && i.slot === slot)?.id).catch(error => pushBanner(String(error), '#f87171'));
      },
      onKillMonster: async (xp, zen) => {
        const c = charRef.current;
        if (!c) return;
        let nextXp = c.xp + xp;
        let nextLevel = c.level;
        let nextXpToNext = c.xpToNext;
        let nextMaxHp = c.maxHp;
        let nextMaxMp = c.maxMp;
        let nextMaxSd = c.maxSd;
        let nextMaxAg = c.maxAg;
        let unspentPoints = c.unspentPoints;
        let leveledUp = false;

        while (nextXp >= nextXpToNext) {
          nextXp -= nextXpToNext;
          nextLevel += 1;
          nextXpToNext = Math.round(nextXpToNext * 1.25);
          nextMaxHp += 28;
          nextMaxMp += 18;
          nextMaxSd += 22;
          nextMaxAg += 5;
          unspentPoints += c.classType === 'MG' || c.classType === 'DL' ? 7 : 5;
          leveledUp = true;
          pushBanner(`¡Subiste a Nivel ${nextLevel}! (+Puntos de Stats)`, '#fbbf24');
        }

        if (leveledUp) {
          soundSynth.playLevelUp();
        }

        const updated: MuCharacter = {
          ...c,
          level: nextLevel,
          xp: nextXp,
          xpToNext: nextXpToNext,
          unspentPoints,
          maxHp: nextMaxHp,
          hp: leveledUp ? nextMaxHp : c.hp,
          maxMp: nextMaxMp,
          mp: leveledUp ? nextMaxMp : c.mp,
          maxSd: nextMaxSd,
          sd: leveledUp ? nextMaxSd : c.sd,
          maxAg: nextMaxAg,
          ag: leveledUp ? nextMaxAg : c.ag,
          zen: c.zen + zen,
          kills: c.kills + 1,
        };
        const saved = await updateCharacter(updated);
        setCharacter(saved);
      },
      onPickupLoot: async (drop) => {
        const c = charRef.current;
        if (!c) return;
        const updated: MuCharacter = {
          ...c,
          zen: c.zen + (drop.kind === 'zen' ? drop.amount : 0),
          bless: c.bless + (drop.kind === 'bless' ? drop.amount : 0),
          soul: c.soul + (drop.kind === 'soul' ? drop.amount : 0),
          chaos: c.chaos + (drop.kind === 'chaos' ? drop.amount : 0),
          life: c.life + (drop.kind === 'life' ? drop.amount : 0),
        };
        const saved = await updateCharacter(updated);
        setCharacter(saved);
        pushBanner(
          `+${drop.label}`,
          drop.kind === 'bless'
            ? '#f87171'
            : drop.kind === 'soul'
              ? '#60a5fa'
              : drop.kind === 'life'
                ? '#c084fc'
                : '#fbbf24',
        );
      },
      onPlayerDamaged: (amount) => {
        setCharacter((prev) => {
          if (!prev) return prev;
          const sdAbsorb = Math.min(prev.sd, Math.round(amount * 0.7));
          const hpDamage = Math.max(1, amount - sdAbsorb);
          return {
            ...prev,
            sd: Math.max(0, prev.sd - sdAbsorb),
            hp: Math.max(20, prev.hp - hpDamage),
          };
        });
      },
      onHeroMoveSync: (x, z, rotY, action) => {
        if (roomRef.current && syncRef.current) {
          syncRef.current.sendPeerUpdate({ x, z, rotY, action, currentMapId: charRef.current?.currentMapId, sex: charRef.current?.sex, equipment: itemsRef.current.filter(i => i.isEquipped) });
        }
      },
      onBossHitInEvent: (damage) => {
        syncRef.current?.damageBoss(damage, charRef.current?.name || 'Héroe');
      },
      onFloatingText: (text, color) => {
        pushBanner(text, color);
      },
      onDamageNumber: (dmg) => {
        pushDamageNumber(dmg);
      },
      onNearbyNpcChange: (npc) => {
        setNearbyNpc(npc);
      },
      onOpenNpc: (npc) => {
        setActiveNpc(npc);
        setNpcStatusMessage(null);
        setActiveDrawer('npc');
      },
      onFpsUpdate: (fps) => {
        setMeasuredFps(fps);
      },
      onWorldTelemetry: (info) => {
        setWorldTelemetry(info);
      },
    };

    let engine: MuWorldEngine;
    try { engine = new MuWorldEngine(mount, callbacks, { headless: import.meta.env.DEV && new URLSearchParams(location.search).has('headless') }); }
    catch (error) { console.error(error);setEngineError('No hay aceleración WebGL disponible en este navegador. Abre el juego en un navegador con WebGL para ver el mundo 3D.');return; }
    if (import.meta.env.DEV) (window as any).__muEngine = engine;
    engineRef.current = engine;
    engine.setBrightness(settingsRef.current.brightness);
    engine.setAudio(settingsRef.current.volume, settingsRef.current.muted);
    engine.setFree3dMode(settingsRef.current.free3dCamera);
    engine.setTargetFps(settingsRef.current.targetFps);

    if (charRef.current) {
      engine.updateHeroStats(charRef.current);
      engine.syncHeroAppearance(
        charRef.current.classType,
        itemsRef.current.filter((i) => i.isEquipped),
        charRef.current.sex,
      ).catch(console.error);
    }

    return () => {
      engine.dispose();
      engineRef.current = null;
      if (import.meta.env.DEV) delete (window as any).__muEngine;
    };
  }, [pushBanner, pushDamageNumber]);

  const computeBonusStatPower = (c: MuCharacter) =>
    Math.round((c.str + c.ene + c.agi + c.cmd) * 0.45);

  const handleCastSkill = useCallback(
    (skill: SkillDef) => {
      const c = charRef.current;
      if (!c || screenStageRef.current !== 'playing') return;

      // Safe city blocks offensive skills cleanly without spending MP/AG
      if (engineRef.current?.isInSafeCity() && !skill.isBuff) {
        engineRef.current.executeSkill(skill, 1, computeBonusStatPower(c));
        return;
      }

      const useSkill =
        c.mp >= skill.mpCost && c.ag >= skill.agCost
          ? skill
          : MU_SKILLS[c.classType][0];

      if (useSkill.id !== skill.id) {
        pushBanner('MP/AG bajo · Ataque básico', '#f87171');
      }

      setCharacter((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          mp: Math.max(0, prev.mp - useSkill.mpCost),
          ag: Math.max(0, prev.ag - useSkill.agCost),
          hp: useSkill.isBuff ? Math.min(prev.maxHp, prev.hp + 55) : prev.hp,
          sd: useSkill.isBuff ? Math.min(prev.maxSd, prev.sd + 45) : prev.sd,
        };
      });

      engineRef.current?.executeSkill(useSkill, 1, computeBonusStatPower(c));
    },
    [pushBanner],
  );

  const handlePressAttack = useCallback(() => {
    const c = charRef.current;
    if (!c || screenStageRef.current !== 'playing') return;
    const classSkills = MU_SKILLS[c.classType] || MU_SKILLS.DK;

    if (engineRef.current?.isInSafeCity()) {
      const def = classSkills.find((s) => s.id === comboConfig.defaultSkillId) || classSkills[0];
      engineRef.current.executeSkill(def, 1, computeBonusStatPower(c));
      return;
    }

    if (comboArmed) {
      const s1 = classSkills.find((s) => s.id === comboConfig.comboSkillIds[0]) || classSkills[1] || classSkills[0];
      const s2 = classSkills.find((s) => s.id === comboConfig.comboSkillIds[1]) || classSkills[2] || classSkills[0];
      const s3 = classSkills.find((s) => s.id === comboConfig.comboSkillIds[2]) || classSkills[3] || classSkills[0];
      const totalMp = Math.round((s1.mpCost + s2.mpCost + s3.mpCost) * 0.65);
      const totalAg = Math.round((s1.agCost + s2.agCost + s3.agCost) * 0.65);

      if (c.mp < totalMp || c.ag < totalAg) {
        pushBanner('MP/AG insuficiente para Combo · Ataque base', '#fbbf24');
        const def = classSkills.find((s) => s.id === comboConfig.defaultSkillId) || classSkills[0];
        handleCastSkill(def);
        return;
      }

      setCharacter((prev) =>
        prev
          ? {
              ...prev,
              mp: Math.max(0, prev.mp - totalMp),
              ag: Math.max(0, prev.ag - totalAg),
            }
          : prev,
      );
      engineRef.current?.executeComboChain([s1, s2, s3], computeBonusStatPower(c));
    } else {
      const def = classSkills.find((s) => s.id === comboConfig.defaultSkillId) || classSkills[0];
      handleCastSkill(def);
    }
  }, [comboArmed, comboConfig, handleCastSkill, pushBanner]);

  // Global keyboard shortcuts while playing/paused
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT'
      ) {
        return;
      }
      if (e.code === 'Escape') {
        if (activeDrawer !== 'none') {
          setActiveDrawer('none');
        } else if (editMode) {
          setEditMode(false);
        } else if (screenStage === 'playing') {
          setScreenStage('paused');
        } else if (screenStage === 'paused') {
          setScreenStage('playing');
        }
        return;
      }

      if (screenStage !== 'playing' || activeDrawer !== 'none') return;
      const c = charRef.current;
      if (!c) return;
      const skills = MU_SKILLS[c.classType];

      if (e.code === 'Space') {
        e.preventDefault();
        handlePressAttack();
      } else if (e.code === 'Digit1' && skills[0]) {
        handleCastSkill(skills[0]);
      } else if (e.code === 'Digit2' && skills[1]) {
        handleCastSkill(skills[1]);
      } else if (e.code === 'Digit3' && skills[2]) {
        handleCastSkill(skills[2]);
      } else if (e.code === 'Digit4' && skills[3]) {
        handleCastSkill(skills[3]);
      } else if (e.code === 'Digit5' && skills[4]) {
        handleCastSkill(skills[4]);
      } else if (e.code === 'Digit6' && skills[5]) {
        handleCastSkill(skills[5]);
      } else if (e.code === 'KeyM') {
        setActiveDrawer('mapWarp');
      } else if (e.code === 'KeyC') {
        setActiveDrawer('stats');
      } else if (e.code === 'KeyV' || e.code === 'KeyI') {
        setActiveDrawer('inventory');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screenStage, activeDrawer, editMode, handlePressAttack, handleCastSkill]);

  const handleLogin = async (username: string, password: string) => {
    const res = await loginAccount(username, password);
    if (!res.ok) return { ok: false, error: res.error };
    setCurrentAccount(res.account);
    cloudSyncManager.setActiveAccountId(res.account.id);
    const chars = await listCharactersByAccount(res.account.id);
    setCharacters(chars);
    if (chars[0]) {
      await selectAndHydrateCharacter(chars[0]);
    } else {
      setCharacter(null);
      engineRef.current?.updateHeroStats(null);
      setItems([]);
    }
    engineRef.current?.setMode('character_select');
    setScreenStage('character_select');
    return { ok: true };
  };

  const handleRegister = async (input: {
    username: string;
    password: string;
    secretQ1: string;
    secretA1: string;
    secretQ2: string;
    secretA2: string;
  }) => {
    const res = await registerAccount(input);
    if (!res.ok) return { ok: false, error: res.error };
    setAccounts(await listAccounts());
    setCurrentAccount(res.account);
    cloudSyncManager.setActiveAccountId(res.account.id);
    setCharacters([]);
    setCharacter(null);
    engineRef.current?.updateHeroStats(null);
    setItems([]);
    engineRef.current?.setMode('character_select');
    setScreenStage('character_select');
    return { ok: true };
  };

  const handleChangePassword = async (
    username: string,
    oldPassword: string,
    newPassword: string,
  ) => {
    const res = await changeAccountPassword(username, oldPassword, newPassword);
    if (res.ok) {
      setAccounts(await listAccounts());
    }
    return res;
  };

  const handleLookupRecoveryQuestions = async (
    username: string,
  ): Promise<
    | { found: true; secretQ1: string; secretQ2: string; source: 'local' | 'cloud' }
    | { found: false; error?: string }
  > => {
    const local = await getLocalRecoveryQuestions(username);
    if (local.found) {
      return { found: true, secretQ1: local.secretQ1, secretQ2: local.secretQ2, source: 'local' };
    }
    const cloud = await cloudSyncManager.fetchRecoveryQuestionsFromCloud(username);
    if (cloud.found) {
      return { found: true, secretQ1: cloud.secretQ1, secretQ2: cloud.secretQ2, source: 'cloud' };
    }
    return { found: false, error: cloud.error };
  };

  const handleRecoverAccount = async (input: {
    username: string;
    answer1: string;
    answer2: string;
    newPassword: string;
  }) => {
    const local = await getLocalRecoveryQuestions(input.username);
    if (local.found) {
      const res = await recoverAccountLocal(
        input.username,
        input.answer1,
        input.answer2,
        input.newPassword,
      );
      if (!res.ok) return { ok: false, error: res.error };
      setAccounts(await listAccounts());
      return {
        ok: true,
        message: 'Contraseña restablecida localmente en IndexedDB. Ya puedes iniciar sesión.',
      };
    }

    const cloudRes = await cloudSyncManager.recoverAccountFromCloud(input);
    if (!cloudRes.ok) {
      return { ok: false, error: cloudRes.error };
    }
    setAccounts(await listAccounts());
    return {
      ok: true,
      message: `Cuenta recuperada desde la nube (${cloudRes.charactersCount} personaje(s) descargados a IndexedDB).`,
    };
  };

  const handleCreateCharacter = async (name: string, classType: HeroClass, sex: 'male' | 'female') => {
    if (!currentAccount) return;
    const created = await createCharacterForAccount(currentAccount.id, name, classType, sex);
    const chars = await listCharactersByAccount(currentAccount.id);
    setCharacters(chars);
    await selectAndHydrateCharacter(created);
    soundSynth.playForge(true);
  };

  const handleEnterWorld = async () => {
    const engine = engineRef.current;
    if (!character || !engine || worldLoadRef.current) return;
    worldLoadRef.current = true; setWorldLoading(true);
    try {
      if (window.innerWidth < 1024) await requestLandscapeFullscreen();
      engine.updateHeroStats(character);
      await engine.syncHeroAppearance(character.classType, items.filter(i => i.isEquipped), character.sex);
      await engine.loadMap(character.currentMapId || 'lorencia', true);
      engine.setMode('playing'); setScreenStage('playing');
    } catch(error) {
      pushBanner(`No se pudo cargar el personaje o mapa: ${String(error)}`, '#f87171');
    } finally { worldLoadRef.current = false; setWorldLoading(false); }
  };

  const handleWarpToMap = async (mapId: MapId) => {
    const engine = engineRef.current;
    if (!character || !engine || worldLoadRef.current) return;
    const mapCfg = getMapById(mapId);
    if (character.zen < mapCfg.warpZen) {
      pushBanner(`Necesitas ${mapCfg.warpZen.toLocaleString()} Zen para viajar a ${mapCfg.name}`, '#f87171'); return;
    }
    worldLoadRef.current = true; setWorldLoading(true);
    try {
      await engine.loadMap(mapId, true);
      const latest = charRef.current;
      if (!latest || latest.id !== character.id) return;
      const saved = await updateCharacter({ ...latest, zen: latest.zen - mapCfg.warpZen, currentMapId: mapId });
      setCharacter(saved); setActiveDrawer('none');
      pushBanner(`Teletransportado a ${mapCfg.name} (${mapCfg.areaKm2.toFixed(2)} km²)`, '#38bdf8');
    } catch(error) {
      pushBanner(`No se pudo viajar: ${String(error)}`, '#f87171');
      try { await engine.loadMap(character.currentMapId, true); }
      catch { engine.setMode('character_select'); setScreenStage('character_select'); }
    } finally { worldLoadRef.current = false; setWorldLoading(false); }
  };

  const handleUpdateSettings = async (next: GameSettings) => {
    setGameSettings(next);
    await saveGameSettings(next);
  };

  const handleUpdateButtonLayouts = async (next: Record<HudButtonId, ButtonLayoutItem>) => {
    setButtonLayouts(next);
    await saveButtonLayouts(next);
  };

  const handleUpdateComboConfig = async (next: CharacterComboConfig) => {
    setComboConfig(next);
    if (character) {
      await saveComboConfig(character.id, next);
    }
  };

  const handleHealPotion = async () => {
    if (!character) return;
    const updated = {
      ...character,
      hp: character.maxHp,
      mp: character.maxMp,
      sd: character.maxSd,
      ag: character.maxAg,
    };
    const saved = await updateCharacter(updated);
    setCharacter(saved);
    soundSynth.playTradeSync();
    pushBanner('HP, MP, SD y AG restaurados', '#4ade80');
  };

  const handleEquip = async (itemId: string) => {
    if (!character) return;
    const nextItems = await equipItem(character.id, itemId);
    setItems(nextItems);
    engineRef.current?.syncHeroAppearance(
      character.classType,
      nextItems.filter((i) => i.isEquipped),
      character.sex,
    ).catch(console.error);
    soundSynth.playForge(true);
    setForgeMessage('Equipo actualizado y guardado en IndexedDB (Dexie).');
  };

  const handleUpgrade = async (itemId: string, jewel: 'bless' | 'soul' | 'life' | 'harmony') => {
    if (!character) return;
    const result = await upgradeItemWithJewel(character, itemId, jewel);
    setCharacter(result.character);
    setItems(result.items);
    setForgeMessage(result.message);
    soundSynth.playForge(result.success);
    engineRef.current?.syncHeroAppearance(
      result.character.classType,
      result.items.filter((i) => i.isEquipped),
      result.character.sex,
    ).catch(console.error);
  };

  const handleAllocateStat = async (stat: 'str' | 'agi' | 'vit' | 'ene' | 'cmd', amount: number) => {
    if (!character) return;
    const res = await allocateStatPoint(character, stat, amount);
    if (res.ok) {
      setCharacter(res.character);
      soundSynth.playTradeSync();
    } else if (res.message) {
      pushBanner(res.message, '#f87171');
    }
  };

  const handleBuyShopItem = async (shopItem: ShopItemDef) => {
    if (!character) return;
    const res = await buyShopItem(character, shopItem);
    setCharacter(res.character);
    setItems(res.items);
    setNpcStatusMessage(res.message);
    soundSynth.playForge(res.ok);
  };

  const handleBuyJewel = async (jewel: 'bless' | 'soul' | 'chaos' | 'life' | 'harmony', cost: number) => {
    if (!character) return;
    const res = await buyJewelFromNpc(character, jewel, cost);
    setCharacter(res.character);
    setNpcStatusMessage(res.message);
    soundSynth.playJewelDrop();
  };

  const handleSellItem = async (itemId: string) => {
    if (!character) return;
    const res = await sellInventoryItem(character, itemId);
    setCharacter(res.character);
    setItems(res.items);
    setNpcStatusMessage(res.message);
    soundSynth.playTradeSync();
  };

  const handleChaosMixWing = async (tier: 2 | 3) => {
    if (!character) return;
    const res = await executeChaosMixWing(character, tier);
    setCharacter(res.character);
    setItems(res.items);
    setNpcStatusMessage(res.message);
    soundSynth.playForge(res.ok);
  };

  const buildPeerSnapshot = (): RoomPeer => {
    const c = character!;
    const eqWeapon = items.find((i) => i.slot === 'weapon' && i.isEquipped);
    const eqArmor = items.find((i) => i.slot === 'armor' && i.isEquipped);
    return {
      peerId: syncRef.current?.peerId || 'peer-local',
      name: c.name,
      classType: c.classType,
      sex: c.sex ?? 'male',
      currentMapId: c.currentMapId,
      equipment: items.filter(i => i.isEquipped),
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

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0c1018]">
      {engineError && <div role="alert" className="fixed top-2 left-2 right-2 z-50 rounded bg-red-950/95 text-red-100 p-3 text-sm">{engineError}</div>}
      <div ref={canvasMountRef} className="absolute inset-0 w-full h-full" />

      {worldLoading && <div role="status" aria-live="polite" className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/90 text-amber-200"><div className="text-center space-y-3"><div className="mx-auto w-10 h-10 rounded-full border-4 border-amber-900 border-t-amber-300 animate-spin" /><p>Cargando personaje y escenario…</p></div></div>}
      <OfflineIndicator />

      {isPortraitMobile && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg bg-[#161c2a] border border-amber-500/70 px-3 py-1.5 shadow-xl max-w-[94vw]">
          <span className="text-[11px] text-amber-200 whitespace-nowrap">
            Recomendado en Horizontal
          </span>
          <button
            onClick={requestLandscapeFullscreen}
            className="min-h-[30px] px-2.5 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-[11px] inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
          >
            <RotateCw className="w-3 h-3" />
            Girar
          </button>
        </div>
      )}

      {(screenStage === 'login' || screenStage === 'character_select') && (
        <ClassicLoginFlow
          stage={screenStage}
          accounts={accounts}
          currentAccount={currentAccount}
          characters={characters}
          selectedCharId={character?.id || null}
          syncStatus={syncStatus}
          onLogin={handleLogin}
          onRegister={handleRegister}
          onChangePassword={handleChangePassword}
          onLookupRecoveryQuestions={handleLookupRecoveryQuestions}
          onRecoverAccount={handleRecoverAccount}
          onSelectCharacter={(id) => {
            const found = characters.find((c) => c.id === id);
            if (found) selectAndHydrateCharacter(found);
          }}
          onCreateCharacter={handleCreateCharacter}
          onEnterWorld={handleEnterWorld}
          onLogoutAccount={() => {
            setCurrentAccount(null);
            cloudSyncManager.setActiveAccountId(null);
            engineRef.current?.setMode('title');
            setScreenStage('login');
          }}
          onOpenApkCenter={() => setActiveDrawer('apk')}
          onPreviewClass={(cls, sex) => engineRef.current?.syncHeroAppearance(cls, getStarterItemsForMuClass('preview','Vista previa',cls), sex).catch(console.error)}
        />
      )}

      {(screenStage === 'playing' || screenStage === 'paused') && character && (
        <>
          {roomState && (
            <div className="pointer-events-none fixed top-2.5 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5">
              <div className="rounded-lg bg-[#0e131d]/92 border border-sky-500/40 px-3 py-1 text-xs font-mono-tabular text-sky-200 flex items-center gap-2">
                {roomState.transport === 'wifi' ? (
                  <Wifi className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                ) : (
                  <Bluetooth className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                )}
                <span>
                  Sala {roomState.code} · {roomState.peers.length} conectados
                </span>
              </div>

              {roomState.activeEvent && (
                <div className="w-[min(340px,70vw)] rounded-lg bg-[#1a1014]/95 border border-rose-500/60 px-3 py-1.5 shadow-xl">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-rose-200">
                    <span className="inline-flex items-center gap-1">
                      <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                      Jefe · Oleada {roomState.eventWave}
                    </span>
                    <span className="font-mono-tabular">
                      {roomState.bossHp} / {roomState.bossMaxHp}
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full rounded bg-slate-900 overflow-hidden">
                    <div
                      className="h-full bg-rose-500 transition-all"
                      style={{ width: `${Math.round((roomState.bossHp / roomState.bossMaxHp) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Floating Combat & Loot Feedback */}
          <div className="pointer-events-none fixed top-20 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1">
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

          <MuHudOverlay
            character={character}
            comboConfig={comboConfig}
            comboArmed={comboArmed}
            buttonLayouts={buttonLayouts}
            editMode={editMode}
            measuredFps={measuredFps}
            free3dCamera={gameSettings.free3dCamera}
            nearbyNpc={nearbyNpc}
            worldTelemetry={worldTelemetry}
            damageNumbers={damageNumbers}
            syncStatus={syncStatus}
            onJoystickVector={(x, y) => engineRef.current?.setJoystickVector(x, y)}
            onPressAttack={handlePressAttack}
            onJump={() => engineRef.current?.jump()}
            onToggleComboArmed={() => setComboArmed((v) => !v)}
            onCastSkill={handleCastSkill}
            onUpdateComboConfig={handleUpdateComboConfig}
            onHealPotion={handleHealPotion}
            onPickupLoot={() => engineRef.current?.pickupNearestLoot()}
            onTalkNpc={(npc) => {
              setActiveNpc(npc);
              setNpcStatusMessage(null);
              setActiveDrawer('npc');
            }}
            onOpenInventory={() => setActiveDrawer('inventory')}
            onOpenMapWarp={() => setActiveDrawer('mapWarp')}
            onOpenStats={() => setActiveDrawer('stats')}
            onOpenSync={() => setActiveDrawer('sync')}
            onOpenOracle={() => setActiveDrawer('oracle')}
            onOpenApk={() => setActiveDrawer('apk')}
            onOpenSettings={() => setActiveDrawer('settings')}
            onUpdateButtonLayouts={handleUpdateButtonLayouts}
            onExitEditMode={() => setEditMode(false)}
          />
        </>
      )}

      {screenStage === 'paused' && activeDrawer === 'none' && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[#111622] border-2 border-amber-700/70 p-6 space-y-3 shadow-2xl">
            <h2 className="font-display text-xl font-bold text-amber-300 text-center">
              Juego en Pausa
            </h2>
            <p className="text-xs text-slate-400 text-center">
              Tu progreso, botones y equipamiento están guardados offline en IndexedDB (Dexie) y sincronizados con la nube.
            </p>
            <button
              onClick={() => setScreenStage('playing')}
              className="w-full min-h-[44px] rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-sm cursor-pointer"
            >
              Continuar Jugando
            </button>
            <button
              onClick={() => setActiveDrawer('settings')}
              className="w-full min-h-[44px] rounded-lg bg-[#192233] hover:bg-slate-700 text-slate-100 font-semibold text-sm cursor-pointer"
            >
              Ajustes (Brillo, Música, Sonido, 3D)
            </button>
            <button
              onClick={() => {
                engineRef.current?.setMode('character_select');
                setScreenStage('character_select');
              }}
              className="w-full min-h-[44px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm cursor-pointer"
            >
              Cambiar Personaje
            </button>
          </div>
        </div>
      )}

      {character && (
        <>
          <MuInventoryModal
            open={activeDrawer === 'inventory'}
            character={character}
            items={items}
            onClose={() => {
              setActiveDrawer('none');
              setForgeMessage(null);
            }}
            onEquip={handleEquip}
            onRepair={async () => { if (!character) return; try { const saved=await repairEquipment(character.id); await selectAndHydrateCharacter(saved); } catch(error) { setForgeMessage(String(error)); } }}
            onUpgrade={handleUpgrade}
            forgeMessage={forgeMessage}
          />

          <MapWarpModal
            open={activeDrawer === 'mapWarp'}
            character={character}
            currentMapId={character.currentMapId}
            onClose={() => setActiveDrawer('none')}
            onWarpToMap={handleWarpToMap}
          />

          <CharacterStatsModal
            open={activeDrawer === 'stats'}
            character={character}
            items={items}
            onClose={() => setActiveDrawer('none')}
            onAllocateStat={handleAllocateStat}
          />

          <NpcShopModal
            open={activeDrawer === 'npc'}
            npc={activeNpc}
            character={character}
            items={items}
            statusMessage={npcStatusMessage}
            onClose={() => {
              setActiveDrawer('none');
              setNpcStatusMessage(null);
            }}
            onBuyItem={handleBuyShopItem}
            onBuyJewel={handleBuyJewel}
            onSellItem={handleSellItem}
            onChaosMixWing={handleChaosMixWing}
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

      <SettingsModal
        open={activeDrawer === 'settings'}
        settings={gameSettings}
        measuredFps={measuredFps}
        onClose={() => setActiveDrawer('none')}
        onUpdateSettings={handleUpdateSettings}
        onEnterButtonEditor={() => setEditMode(true)}
        onRequestLandscapeFullscreen={requestLandscapeFullscreen}
        onSwitchCharacter={() => {
          setActiveDrawer('none');
          engineRef.current?.setMode('character_select');
          setScreenStage('character_select');
        }}
      />

      <ApkSyncDrawer
        open={activeDrawer === 'apk'}
        syncStatus={syncStatus}
        onClose={() => setActiveDrawer('none')}
        onDatabaseImported={async () => {
          await loadAllFromDexie();
        }}
      />
    </div>
  );
}
