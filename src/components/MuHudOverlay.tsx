import React, { useEffect, useRef, useState } from 'react';
import {
  Backpack,
  Bot,
  Check,
  Compass,
  Flame,
  Hand,
  Heart,
  MessageSquare,
  RotateCcw,
  Settings,
  Shield,
  SlidersHorizontal,
  Sword,
  Swords,
  User,
  Wifi,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { DEFAULT_BUTTON_LAYOUTS, MU_SKILLS } from '../data/muSkillsAndClasses';
import { getMapById } from '../data/muWorldData';
import type {
  ActiveEffect,
  ButtonLayoutItem,
  CharacterComboConfig,
  FloatingDamageNumber,
  HudButtonId,
  MinimapEntitySnapshot,
  MuCharacter,
  NpcDef,
  SkillDef,
} from '../types/game';
import type { TargetMonsterInfo } from '../game/MuWorldEngine';
import { getSkillRank } from '../game/combatAndProgression';
import {
  POTION_TIERS,
  projectToMinimap,
  type LootFilterKey,
  type LootFilterSettings,
  type PotionConfig,
} from '../game/worldPhysicsMath';
import { PWAInstallButton } from './PWAInstallButton';
import { PubgJoystick } from './PubgJoystick';

export interface WorldTelemetryInfo {
  x: number;
  z: number;
  inSafeCity: boolean;
  totalMonsters: number;
  nearbyMonsters: number;
  mapName: string;
  areaKm2: number;
}

interface MuHudOverlayProps {
  character: MuCharacter;
  comboConfig: CharacterComboConfig;
  comboArmed: boolean;
  autoHuntEnabled: boolean;
  buttonLayouts: Record<HudButtonId, ButtonLayoutItem>;
  editMode: boolean;
  measuredFps: number;
  free3dCamera: boolean;
  activeEffects: ActiveEffect[];
  targetMonster: TargetMonsterInfo | null;
  skillCooldowns: Record<string, number>;
  nearbyNpc: NpcDef | null;
  worldTelemetry: WorldTelemetryInfo;
  damageNumbers: FloatingDamageNumber[];
  minimapData: MinimapEntitySnapshot | null;
  getMinimapTerrainGrid?: (spanMeters: number, centerX?: number, centerZ?: number) => number[] | null;
  lootFilters: LootFilterSettings;
  potionConfig: PotionConfig;
  onUpdateLootFilters: (next: LootFilterSettings) => void;
  onUpdatePotionConfig: (next: PotionConfig) => void;
  onJoystickVector: (x: number, y: number) => void;
  onPressAttack: () => void;
  onJump: () => void;
  onToggleComboArmed: () => void;
  onToggleAutoHunt: () => void;
  onCastSkill: (skill: SkillDef) => void;
  onUpdateComboConfig: (next: CharacterComboConfig) => void;
  onHealPotion: () => void;
  onPickupLoot: () => void;
  onTalkNpc: (npc: NpcDef) => void;
  onOpenInventory: () => void;
  onOpenMapWarp: () => void;
  onOpenStats: () => void;
  onOpenSync: () => void;
  onOpenOracle: () => void;
  onOpenApk: () => void;
  onOpenSettings: () => void;
  onUpdateButtonLayouts: (next: Record<HudButtonId, ButtonLayoutItem>) => void;
  onExitEditMode: () => void;
}

const LOOT_FILTER_OPTIONS: Array<{ key: LootFilterKey; label: string; colorClass: string }> = [
  { key: 'zen', label: 'Zen', colorClass: 'text-amber-300' },
  { key: 'life', label: 'Life', colorClass: 'text-purple-300' },
  { key: 'soul', label: 'Soul', colorClass: 'text-sky-300' },
  { key: 'bless', label: 'Bless', colorClass: 'text-rose-300' },
  { key: 'chaos', label: 'Chaos', colorClass: 'text-amber-200' },
  { key: 'creation', label: 'Creation', colorClass: 'text-emerald-300' },
  { key: 'talisman', label: 'Talismán', colorClass: 'text-yellow-300' },
];

export const MuHudOverlay: React.FC<MuHudOverlayProps> = ({
  character,
  comboConfig,
  comboArmed,
  autoHuntEnabled,
  buttonLayouts,
  editMode,
  measuredFps,
  free3dCamera,
  activeEffects,
  targetMonster,
  skillCooldowns,
  nearbyNpc,
  worldTelemetry,
  damageNumbers,
  minimapData,
  getMinimapTerrainGrid,
  lootFilters,
  potionConfig,
  onUpdateLootFilters,
  onUpdatePotionConfig,
  onJoystickVector,
  onPressAttack,
  onJump,
  onToggleComboArmed,
  onToggleAutoHunt,
  onCastSkill,
  onUpdateComboConfig,
  onHealPotion,
  onPickupLoot,
  onTalkNpc,
  onOpenInventory,
  onOpenMapWarp,
  onOpenStats,
  onOpenSync,
  onOpenOracle,
  onOpenApk,
  onOpenSettings,
  onUpdateButtonLayouts,
  onExitEditMode,
}) => {
  const [selectedEditId, setSelectedEditId] = useState<HudButtonId | null>('attack');
  const [showComboPicker, setShowComboPicker] = useState(false);
  const [powersOpen, setPowersOpen] = useState(true);
  const [assignComboMode, setAssignComboMode] = useState(false);
  const [showLootMenu, setShowLootMenu] = useState(false);
  const [showPotionMenu, setShowPotionMenu] = useState(false);
  const [minimapZoomed, setMinimapZoomed] = useState(false);
  const minimapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastTerrainDrawRef = useRef<{ mapId: string; zoomed: boolean; x: number; z: number; at: number }>({
    mapId: '',
    zoomed: false,
    x: 99999,
    z: 99999,
    at: 0,
  });
  const lastActionFireRef = useRef<Record<string, number>>({});
  const dragState = useRef<{
    id: HudButtonId;
    pointerId: number;
    startX: number;
    startY: number;
    origXPct: number;
    origYPct: number;
  } | null>(null);

  const fireImmediateAction = (actionKey: string, cb: () => void) => {
    if (editMode) return;
    const now = performance.now();
    const prev = lastActionFireRef.current[actionKey] ?? 0;
    if (now - prev < 240) return;
    lastActionFireRef.current[actionKey] = now;
    cb();
  };

  const classSkills = MU_SKILLS[character.classType] || MU_SKILLS.DK;
  const defaultSkill =
    classSkills.find((s) => s.id === comboConfig.defaultSkillId) || classSkills[0];
  const mapCfg = getMapById(character.currentMapId);

  const hpPct = Math.max(0, Math.min(100, Math.round((character.hp / character.maxHp) * 100)));
  const mpPct = Math.max(0, Math.min(100, Math.round((character.mp / character.maxMp) * 100)));
  const sdPct = Math.max(0, Math.min(100, Math.round((character.sd / character.maxSd) * 100)));
  const agPct = Math.max(0, Math.min(100, Math.round((character.ag / character.maxAg) * 100)));
  const xpPct = Math.max(0, Math.min(100, Math.round((character.xp / character.xpToNext) * 100)));

  const startDragButton = (id: HudButtonId, e: React.PointerEvent<HTMLDivElement>) => {
    if (!editMode) return;
    e.stopPropagation();
    setSelectedEditId(id);
    const current = buttonLayouts[id] || DEFAULT_BUTTON_LAYOUTS[id];
    dragState.current = {
      id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origXPct: current.xPct,
      origYPct: current.yPct,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const moveDragButton = (id: HudButtonId, e: React.PointerEvent<HTMLDivElement>) => {
    if (!editMode || !dragState.current || dragState.current.id !== id) return;
    if (dragState.current.pointerId !== e.pointerId) return;
    e.stopPropagation();

    const dxPct = ((e.clientX - dragState.current.startX) / window.innerWidth) * 100;
    const dyPct = ((e.clientY - dragState.current.startY) / window.innerHeight) * 100;
    const nextX = Math.max(5, Math.min(95, dragState.current.origXPct + dxPct));
    const nextY = Math.max(6, Math.min(93, dragState.current.origYPct + dyPct));

    onUpdateButtonLayouts({
      ...buttonLayouts,
      [id]: { ...(buttonLayouts[id] || DEFAULT_BUTTON_LAYOUTS[id]), xPct: nextX, yPct: nextY },
    });
  };

  const endDragButton = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragState.current && dragState.current.pointerId === e.pointerId) {
      dragState.current = null;
    }
  };

  const adjustSelectedScale = (delta: number) => {
    if (!selectedEditId) return;
    const cur = buttonLayouts[selectedEditId] || DEFAULT_BUTTON_LAYOUTS[selectedEditId];
    const nextScale = Math.max(0.65, Math.min(1.65, Number((cur.scale + delta).toFixed(2))));
    onUpdateButtonLayouts({
      ...buttonLayouts,
      [selectedEditId]: { ...cur, scale: nextScale },
    });
  };

  const wrapButton = (id: HudButtonId, children: React.ReactNode) => {
    const layout = buttonLayouts[id] || DEFAULT_BUTTON_LAYOUTS[id];
    const isSelected = editMode && selectedEditId === id;
    return (
      <div
        key={id}
        onPointerDown={(e) => startDragButton(id, e)}
        onPointerMove={(e) => moveDragButton(id, e)}
        onPointerUp={endDragButton}
        onPointerCancel={endDragButton}
        style={{
          left: `${layout.xPct}%`,
          top: `${layout.yPct}%`,
          transform: `translate(-50%, -50%) scale(${layout.scale})`,
        }}
        className={`fixed z-20 touch-none select-none ${
          editMode
            ? `cursor-move rounded-xl p-1 ${
                isSelected
                  ? 'ring-2 ring-amber-400 bg-amber-500/20'
                  : 'ring-1 ring-slate-500/60 bg-slate-900/30'
              }`
            : ''
        }`}
      >
        {children}
      </div>
    );
  };

  const cycleComboSlot = (slotIdx: number, skillId: string) => {
    const next = [...comboConfig.comboSkillIds];
    while (next.length < 5) {
      const extra = classSkills.find((s) => !next.includes(s.id)) || classSkills[0];
      next.push(extra.id);
    }
    next[slotIdx] = skillId;
    onUpdateComboConfig({ ...comboConfig, comboSkillIds: next.slice(0, 5) });
  };

  const toggleSkillInCombo = (skillId: string) => {
    const current = [...comboConfig.comboSkillIds].slice(0, 5);
    const existingIdx = current.indexOf(skillId);
    let next: string[];
    if (existingIdx >= 0) {
      if (current.length <= 1) return;
      next = current.filter((id) => id !== skillId);
    } else if (current.length < 5) {
      next = [...current, skillId];
    } else {
      next = [...current.slice(1), skillId];
    }
    onUpdateComboConfig({ ...comboConfig, comboSkillIds: next });
  };

  useEffect(() => {
    if (!minimapData || !getMinimapTerrainGrid) return;
    const canvas = minimapCanvasRef.current;
    if (!canvas) return;
    const now = performance.now();
    const prev = lastTerrainDrawRef.current;
    const moved = Math.hypot(minimapData.hero.x - prev.x, minimapData.hero.z - prev.z);
    if (
      prev.mapId === minimapData.mapId &&
      prev.zoomed === minimapZoomed &&
      (!minimapZoomed || moved < 18) &&
      now - prev.at < 1500
    ) {
      return;
    }
    const spanMeters = minimapZoomed ? Math.min(420, minimapData.sizeMeters) : minimapData.sizeMeters;
    const centerX = minimapZoomed ? minimapData.hero.x : 0;
    const centerZ = minimapZoomed ? minimapData.hero.z : 0;
    const gridSize = 48;
    const heights = getMinimapTerrainGrid(spanMeters, centerX, centerZ);
    if (!heights || heights.length < gridSize * gridSize) return;

    lastTerrainDrawRef.current = {
      mapId: minimapData.mapId,
      zoomed: minimapZoomed,
      x: minimapData.hero.x,
      z: minimapData.hero.z,
      at: now,
    };

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let minH = Infinity;
    let maxH = -Infinity;
    for (let i = 0; i < heights.length; i++) {
      if (heights[i] < minH) minH = heights[i];
      if (heights[i] > maxH) maxH = heights[i];
    }
    const rangeH = Math.max(4, maxH - minH);
    const isVolcanic = minimapData.mapId === 'ceniza';
    const isCoastal = minimapData.mapId === 'puerto';
    const cellW = canvas.width / gridSize;
    const cellH = canvas.height / gridSize;

    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const h = heights[row * gridSize + col];
        const norm = Math.max(0, Math.min(1, (h - minH) / rangeH));
        const prevRowH = row > 0 ? heights[(row - 1) * gridSize + col] : h;
        const prevColH = col > 0 ? heights[row * gridSize + (col - 1)] : h;
        const slope = Math.abs(h - prevRowH) + Math.abs(h - prevColH);
        const contourBoost = slope > 2.6 ? -16 : 0;

        let r: number;
        let g: number;
        let b: number;
        if (isVolcanic) {
          r = Math.round(52 + norm * 115 + contourBoost);
          g = Math.round(22 + norm * 48 + contourBoost);
          b = Math.round(18 + norm * 24);
        } else if (isCoastal && norm < 0.22) {
          r = 16;
          g = Math.round(64 + norm * 110);
          b = Math.round(115 + norm * 90);
        } else {
          r = Math.round(24 + norm * 88 + contourBoost);
          g = Math.round(52 + norm * 78 + contourBoost);
          b = Math.round(28 + norm * 36);
        }
        ctx.fillStyle = `rgb(${Math.max(8, Math.min(250, r))}, ${Math.max(8, Math.min(250, g))}, ${Math.max(8, Math.min(250, b))})`;
        ctx.fillRect(Math.floor(col * cellW), Math.floor(row * cellH), Math.ceil(cellW), Math.ceil(cellH));
      }
    }

    // Draw safe capital zone boundary ring
    const mapInfo = getMapById(minimapData.mapId);
    const spawnX = mapInfo.spawn?.x ?? 0;
    const spawnZ = mapInfo.spawn?.z ?? 0;
    const sx = ((spawnX - (centerX - spanMeters / 2)) / spanMeters) * canvas.width;
    const sy = ((centerZ + spanMeters / 2 - spawnZ) / spanMeters) * canvas.height;
    const sr = (mapInfo.cityRadius / spanMeters) * canvas.width;
    ctx.save();
    ctx.strokeStyle = 'rgba(110, 231, 183, 0.72)';
    ctx.lineWidth = 1.25;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(4, sr), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }, [minimapData, minimapZoomed, getMinimapTerrainGrid]);

  const projectDot = (wx: number, wz: number) => {
    if (!minimapData) return { xPct: 50, yPct: 50 };
    if (!minimapZoomed) {
      return projectToMinimap(wx, wz, minimapData.mapId, minimapData.sizeMeters);
    }
    const span = Math.min(420, minimapData.sizeMeters);
    const half = span / 2;
    const xPct = Math.max(4, Math.min(96, ((wx - (minimapData.hero.x - half)) / span) * 100));
    const yPct = Math.max(6, Math.min(94, ((minimapData.hero.z + half - wz) / span) * 100));
    return { xPct, yPct };
  };

  return (
    <>
      {/* 3D-PROJECTED FLOATING DAMAGE NUMBERS */}
      <div className="pointer-events-none fixed inset-0 z-15 overflow-hidden">
        {damageNumbers.map((d) => (
          <div
            key={d.id}
            style={{
              left: `${d.xPct}%`,
              top: `${d.yPct}%`,
              color: d.color,
              transform: 'translate(-50%, -100%)',
            }}
            className={`absolute font-mono-tabular font-extrabold drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)] transition-transform duration-700 -translate-y-4 ${
              d.isCritical ? 'text-lg sm:text-xl' : 'text-sm sm:text-base'
            }`}
          >
            {d.text}
          </div>
        ))}
      </div>

      {/* TOP-LEFT: Hero Name, Map, FPS & Compact HP/MP/SD/AG/XP Bars */}
      <div className="fixed top-2 left-2.5 z-20 flex flex-col gap-1.5 max-w-[44vw] sm:max-w-[335px]">
        <div
          data-testid="hud-hero-card"
          className="pointer-events-none rounded-lg bg-[#0b1019]/92 border border-amber-700/55 px-2.5 py-1.5 shadow-xl space-y-1"
        >
          <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] flex-wrap leading-tight">
            <span className="font-display font-bold text-amber-300 truncate max-w-[100px] sm:max-w-none">
              {character.name}
            </span>
            <span className="font-mono-tabular text-slate-200">
              {character.classType} Nv.{character.level}
              {character.resets > 0 ? ` R${character.resets}` : ''}
            </span>
            <span className="font-mono-tabular text-sky-300 truncate">
              · {worldTelemetry.mapName || mapCfg.name}
            </span>
            <span className="font-mono-tabular text-emerald-300">{measuredFps} FPS</span>
            {free3dCamera && (
              <span className="hidden xl:inline font-mono-tabular text-purple-300">· 3D 360°</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-1.5 text-[9.5px] sm:text-[10px] font-mono-tabular">
            {worldTelemetry.inSafeCity ? (
              <span className="inline-flex items-center gap-1 text-emerald-300 font-semibold truncate">
                <Shield className="w-3 h-3 shrink-0" />
                <span>Capital Segura</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-rose-300 font-semibold truncate">
                <Swords className="w-3 h-3 shrink-0" />
                <span>Exterior ({worldTelemetry.nearbyMonsters} cerca)</span>
              </span>
            )}
            <span className="text-slate-400 shrink-0">
              ({worldTelemetry.x}, {worldTelemetry.z})
            </span>
          </div>

          {/* HP & MP Top-Left Bars */}
          <div className="grid grid-cols-2 gap-1.5 pt-0.5">
            <div>
              <div className="flex justify-between text-[9px] font-mono-tabular text-rose-200 leading-none mb-0.5">
                <span>HP</span>
                <span>{character.hp}/{character.maxHp}</span>
              </div>
              <div className="h-2 rounded bg-slate-900 border border-rose-900/70 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-rose-700 to-rose-500 transition-all"
                  style={{ width: `${hpPct}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[9px] font-mono-tabular text-sky-200 leading-none mb-0.5">
                <span>MP</span>
                <span>{character.mp}/{character.maxMp}</span>
              </div>
              <div className="h-2 rounded bg-slate-900 border border-sky-900/70 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-700 to-sky-400 transition-all"
                  style={{ width: `${mpPct}%` }}
                />
              </div>
            </div>
          </div>

          {/* SD / AG / XP & Currencies */}
          <div className="grid grid-cols-2 gap-1.5">
            <div className="flex items-center gap-1">
              <span className="text-[8.5px] font-mono-tabular text-amber-300 w-4">SD</span>
              <div className="flex-1 h-1 rounded bg-slate-800 overflow-hidden">
                <div className="h-full bg-amber-400" style={{ width: `${sdPct}%` }} />
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[8.5px] font-mono-tabular text-purple-300 w-4">AG</span>
              <div className="flex-1 h-1 rounded bg-slate-800 overflow-hidden">
                <div className="h-full bg-purple-400" style={{ width: `${agPct}%` }} />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 text-[9px] font-mono-tabular text-slate-300 pt-0.5">
            <span className="text-amber-300 font-semibold">Zen {character.zen.toLocaleString()}</span>
            <span className="text-slate-400">XP {xpPct}%</span>
            <span>
              <span className="text-rose-300">B:{character.bless}</span>{' '}
              <span className="text-sky-300">S:{character.soul}</span>
            </span>
          </div>
          <div className="h-1 w-full rounded bg-slate-900 overflow-hidden">
            <div className="h-full bg-amber-500 transition-all" style={{ width: `${xpPct}%` }} />
          </div>
        </div>

        {/* Oracle & Web APK-WEB Install Button */}
        {!editMode && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={onOpenOracle}
              className="min-h-[34px] px-2.5 rounded-lg bg-[#0e1420]/92 border border-slate-700 hover:border-emerald-500/60 text-emerald-300 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
            >
              <Bot className="w-3.5 h-3.5" />
              Oráculo
            </button>
            <PWAInstallButton compact onOpenApkCenter={onOpenApk} />
          </div>
        )}

        {!editMode && activeEffects.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap pointer-events-none">
            {activeEffects.map((eff) => (
              <div
                key={eff.id}
                style={{ borderColor: eff.color }}
                className="px-1.5 py-0.5 rounded bg-[#0b1019]/92 border text-[9px] font-mono-tabular flex items-center gap-1 shadow"
              >
                <span style={{ color: eff.color }} className="font-bold">
                  {eff.kind === 'buff' ? '▲' : '▼'} {eff.name}
                </span>
                <span className="text-amber-300 font-bold">{Math.ceil(eff.remainingSec)}s</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MOVABLE / DRAGGABLE TOPOGRAPHIC MINI-MAP */}
      {minimapData &&
        wrapButton(
          'minimap',
          <div
            data-testid="hud-minimap"
            className="relative w-[108px] h-[108px] sm:w-[128px] sm:h-[128px] rounded-lg bg-[#090e17]/92 border border-amber-600/70 shadow-xl overflow-hidden select-none"
          >
            <canvas
              ref={minimapCanvasRef}
              width={96}
              height={96}
              className="absolute inset-0 w-full h-full opacity-90 pointer-events-none"
            />
            <div className="absolute inset-x-0 top-1/2 h-px bg-white/10 pointer-events-none" />
            <div className="absolute inset-y-0 left-1/2 w-px bg-white/10 pointer-events-none" />
            <div className="absolute top-0.5 left-1 right-1 flex items-center justify-between text-[8px] font-mono-tabular text-slate-100 bg-black/45 px-1 rounded">
              <span className="truncate font-semibold text-amber-200">
                {getMapById(minimapData.mapId).name}
              </span>
              {!editMode && (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMinimapZoomed((v) => !v);
                  }}
                  title="Alternar vista mapa completo / local"
                  className="text-sky-300 hover:text-white font-bold cursor-pointer pl-1"
                >
                  {minimapZoomed ? '2×' : '1×'}
                </button>
              )}
            </div>

            {/* Red dots = Monsters */}
            {minimapData.monsters.map((m) => {
              const p = projectDot(m.x, m.z);
              return (
                <span
                  key={m.id}
                  style={{ left: `${p.xPct}%`, top: `${p.yPct}%` }}
                  className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${
                    m.isBoss ? 'w-2 h-2 bg-red-500 ring-1 ring-amber-300' : 'w-1.5 h-1.5 bg-red-500/95'
                  }`}
                />
              );
            })}

            {/* Blue dots = NPCs */}
            {minimapData.npcs.map((n) => {
              const p = projectDot(n.x, n.z);
              return (
                <span
                  key={n.id}
                  style={{ left: `${p.xPct}%`, top: `${p.yPct}%` }}
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-sky-400 border border-sky-100/80"
                />
              );
            })}

            {/* Green dots = Wi-Fi / Bluetooth Friends */}
            {minimapData.friends.map((f) => {
              const p = projectDot(f.x, f.z);
              return (
                <span
                  key={f.id}
                  style={{ left: `${p.xPct}%`, top: `${p.yPct}%` }}
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-1 ring-emerald-100"
                />
              );
            })}

            {/* Gold dot = Player Hero */}
            {(() => {
              const hp = projectDot(minimapData.hero.x, minimapData.hero.z);
              return (
                <span
                  data-testid="minimap-hero-dot"
                  style={{ left: `${hp.xPct}%`, top: `${hp.yPct}%` }}
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-amber-100 shadow-[0_0_6px_#fbbf24]"
                />
              );
            })()}

            <div className="pointer-events-none absolute bottom-0 inset-x-0 bg-black/70 px-1 py-0.5 flex items-center justify-between text-[7px] font-mono-tabular">
              <span className="text-amber-300">●Tú</span>
              <span className="text-sky-300">●NPC</span>
              <span className="text-emerald-300">●Amg</span>
              <span className="text-rose-400">●Mob</span>
            </div>
          </div>,
        )}

      {/* TARGET LOCKED MONSTER + DAMAGE TABLE (When outside Safe City) */}
      {targetMonster && !editMode && (
        <div className="pointer-events-none fixed top-16 sm:top-24 right-3 z-20 w-[min(270px,44vw)] rounded-lg bg-[#0d121d]/94 border border-rose-500/60 p-2.5 shadow-xl space-y-1.5">
          <div className="flex items-center justify-between gap-1">
            <div className="text-xs font-bold text-amber-300 truncate">
              Nv.{targetMonster.stats.scaledLevel} {targetMonster.stats.name}
            </div>
            <span className="text-[10px] font-mono-tabular px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 shrink-0">
              Aim {targetMonster.autoAimPct}% · {targetMonster.dist}m
            </span>
          </div>
          <div className="h-2 w-full rounded bg-slate-900 overflow-hidden border border-slate-700">
            <div
              className="h-full bg-gradient-to-r from-rose-600 to-amber-500 transition-all"
              style={{
                width: `${Math.max(0, Math.min(100, Math.round((targetMonster.currentHp / Math.max(1, targetMonster.stats.maxHp)) * 100)))}%`,
              }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono-tabular text-slate-300">
            <span>HP {targetMonster.currentHp}/{targetMonster.stats.maxHp}</span>
            <span>DEF {targetMonster.stats.defense}</span>
          </div>
          <div className="grid grid-cols-2 gap-1 text-[10px] font-mono-tabular pt-1 border-t border-slate-800">
            <div className="text-emerald-300">
              Tu Daño: {targetMonster.stats.damageTable.playerEstNormal} ({targetMonster.stats.damageTable.playerEstCrit}c)
            </div>
            <div className="text-rose-300 text-right">
              Golpe: {targetMonster.stats.damageTable.basicAttack} · Crit: {targetMonster.stats.damageTable.criticalHit} ({targetMonster.stats.damageTable.critChancePct}%)
            </div>
          </div>
          {targetMonster.stats.powers[0] && (
            <div className="text-[10px] text-amber-200/90 truncate">
              Poder: {targetMonster.stats.powers[0].name} ({targetMonster.stats.damageTable.specialPower} dmg)
              {targetMonster.stats.powers[0].effectDebuff ? ` · ${targetMonster.stats.powers[0].effectDebuff}` : ''}
            </div>
          )}
        </div>
      )}

      {/* NEARBY NPC INTERACT BUTTON */}
      {nearbyNpc && !editMode && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-20">
          <button
            onClick={() => onTalkNpc(nearbyNpc)}
            className="min-h-[42px] px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs inline-flex items-center gap-2 shadow-2xl border border-amber-200 cursor-pointer"
          >
            <MessageSquare className="w-4 h-4" />
            Hablar con {nearbyNpc.name}
          </button>
        </div>
      )}

      {/* BUTTON EDITOR FLOATING CONTROL BAR */}
      {editMode && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 flex-wrap justify-center rounded-xl bg-[#0e1420] border-2 border-amber-500 px-3.5 py-2 shadow-2xl max-w-[95vw]">
          <span className="text-xs font-bold text-amber-300 whitespace-nowrap">
            {selectedEditId
              ? `Botón: ${(buttonLayouts[selectedEditId] || DEFAULT_BUTTON_LAYOUTS[selectedEditId]).label} (${Math.round((buttonLayouts[selectedEditId] || DEFAULT_BUTTON_LAYOUTS[selectedEditId]).scale * 100)}%)`
              : 'Toca un botón para mover o escalar'}
          </span>
          <button
            onClick={() => adjustSelectedScale(-0.1)}
            disabled={!selectedEditId}
            className="min-h-[36px] px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs inline-flex items-center gap-1 cursor-pointer"
          >
            <ZoomOut className="w-3.5 h-3.5" />
            Encoger
          </button>
          <button
            onClick={() => adjustSelectedScale(0.1)}
            disabled={!selectedEditId}
            className="min-h-[36px] px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs inline-flex items-center gap-1 cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" />
            Agrandar
          </button>
          <button
            onClick={() => onUpdateButtonLayouts(DEFAULT_BUTTON_LAYOUTS)}
            className="min-h-[36px] px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs inline-flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
          <button
            onClick={onExitEditMode}
            className="min-h-[36px] px-3 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs inline-flex items-center gap-1 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            Guardar
          </button>
        </div>
      )}

      {/* DRAGGABLE & SCALABLE TOP-RIGHT HUD BUTTONS */}
      {wrapButton(
        'mapWarp',
        <button
          onClick={() => !editMode && onOpenMapWarp()}
          className="min-h-[36px] xl:min-h-[40px] px-2 xl:px-2.5 rounded-lg bg-[#0f1522]/92 border border-emerald-600/50 hover:border-emerald-400 text-emerald-200 text-[11px] font-semibold inline-flex items-center gap-1 shadow-lg cursor-pointer whitespace-nowrap"
        >
          <Compass className="w-3.5 h-3.5 text-emerald-400" />
          <span>Mapas<span className="hidden xl:inline"> / Madrigal</span></span>
        </button>,
      )}

      {wrapButton(
        'stats',
        <button
          onClick={() => !editMode && onOpenStats()}
          className="relative min-h-[36px] xl:min-h-[40px] px-2 xl:px-2.5 rounded-lg bg-[#0f1522]/92 border border-purple-500/50 hover:border-purple-400 text-purple-200 text-[11px] font-semibold inline-flex items-center gap-1 shadow-lg cursor-pointer whitespace-nowrap"
        >
          <User className="w-3.5 h-3.5 text-purple-300" />
          <span>Héroe<span className="hidden xl:inline"> / Logros</span></span>
          {character.level >= 99 && (
            <span className="px-1 py-0.2 rounded bg-rose-500 text-white text-[9px] font-bold">
              RESET
            </span>
          )}
          {(character.unspentPoints + (character.skillPoints ?? 0)) > 0 && (
            <span className="px-1 py-0.2 rounded bg-amber-500 text-slate-950 text-[9px] font-bold">
              +{character.unspentPoints + (character.skillPoints ?? 0)}
            </span>
          )}
        </button>,
      )}

      {wrapButton(
        'sync',
        <button
          onClick={() => !editMode && onOpenSync()}
          className="min-h-[36px] xl:min-h-[40px] px-2 xl:px-2.5 rounded-lg bg-[#0f1522]/92 border border-sky-600/50 hover:border-sky-400 text-sky-200 text-[11px] font-semibold inline-flex items-center gap-1 shadow-lg cursor-pointer whitespace-nowrap"
        >
          <Wifi className="w-3.5 h-3.5 text-sky-400" />
          <span>Wi-Fi / BT</span>
        </button>,
      )}

      {wrapButton(
        'inventory',
        <button
          onClick={() => !editMode && onOpenInventory()}
          className="min-h-[36px] xl:min-h-[40px] px-2 xl:px-2.5 rounded-lg bg-[#0f1522]/92 border border-amber-600/60 hover:border-amber-400 text-amber-200 text-[11px] font-semibold inline-flex items-center gap-1 shadow-lg cursor-pointer whitespace-nowrap"
        >
          <Backpack className="w-3.5 h-3.5 text-amber-400" />
          <span>Inventario</span>
        </button>,
      )}

      {wrapButton(
        'settings',
        <button
          onClick={() => !editMode && onOpenSettings()}
          aria-label="Ajustes"
          className="min-h-[38px] min-w-[38px] xl:min-h-[42px] xl:min-w-[42px] rounded-lg bg-[#0f1522]/92 border border-slate-600 hover:border-amber-400 text-slate-100 flex items-center justify-center shadow-lg cursor-pointer"
        >
          <Settings className="w-4 h-4 xl:w-5 xl:h-5 text-amber-300" />
        </button>,
      )}

      {wrapButton(
        'joystick',
        <PubgJoystick
          scale={1}
          disabled={editMode}
          onVectorChange={onJoystickVector}
        />,
      )}

      {wrapButton(
        'potion',
        <div className="relative">
          <button
            data-testid="hud-potion-btn"
            onPointerDown={(e) => {
              if (editMode) return;
              e.stopPropagation();
              fireImmediateAction('potion', onHealPotion);
            }}
            onClick={(e) => {
              e.stopPropagation();
              fireImmediateAction('potion', onHealPotion);
            }}
            className="w-12 h-12 rounded-full bg-[#1a0f14]/92 border-2 border-rose-500/70 text-rose-200 flex flex-col items-center justify-center shadow-lg active:scale-95 cursor-pointer touch-none select-none"
          >
            <Heart className="w-4 h-4 text-rose-400 pointer-events-none" />
            <span className="text-[9px] font-bold pointer-events-none">HP/MP</span>
          </button>

          <button
            type="button"
            data-testid="hud-potion-config-btn"
            aria-label="Configurar poción HP/MP"
            onPointerDown={(e) => {
              if (editMode) return;
              e.stopPropagation();
            }}
            onClick={(e) => {
              if (editMode) return;
              e.stopPropagation();
              setShowLootMenu(false);
              setShowPotionMenu((v) => !v);
            }}
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#0f1624] border border-rose-400/70 text-rose-200 flex items-center justify-center shadow cursor-pointer"
          >
            <SlidersHorizontal className="w-2.5 h-2.5 pointer-events-none" />
          </button>

          {showPotionMenu && !editMode && (
            <div
              data-testid="hud-potion-menu"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="absolute right-14 top-0 w-56 rounded-xl bg-[#0d121d]/96 border border-rose-500/60 p-2.5 shadow-2xl space-y-2 z-30"
            >
              <div className="flex items-center justify-between text-[11px] font-bold text-rose-300">
                <span>Poción Dual HP + MP</span>
                <button
                  type="button"
                  onClick={() => setShowPotionMenu(false)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="space-y-1">
                {POTION_TIERS.map((tier) => {
                  const selected = potionConfig.tierId === tier.id;
                  return (
                    <button
                      key={tier.id}
                      type="button"
                      onClick={() => onUpdatePotionConfig({ ...potionConfig, tierId: tier.id })}
                      className={`w-full px-2 py-1.5 rounded-lg border text-left text-[10px] flex items-center justify-between cursor-pointer ${
                        selected
                          ? 'bg-rose-600/25 border-rose-400 text-rose-100 font-bold'
                          : 'bg-[#141b2b] border-slate-700 text-slate-300'
                      }`}
                    >
                      <span>{tier.shortName}</span>
                      <span className="font-mono-tabular text-amber-300">
                        {tier.zenCost > 0 ? `${tier.zenCost} Zen` : 'Gratis'}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="pt-1 border-t border-slate-800 space-y-1">
                <div className="text-[10px] text-slate-300 font-semibold">
                  Auto-curar en COMBO (&lt; {potionConfig.autoHealThresholdPct}% HP/MP)
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {[35, 55, 75].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => onUpdatePotionConfig({ ...potionConfig, autoHealThresholdPct: pct })}
                      className={`py-1 rounded text-[10px] font-mono-tabular border cursor-pointer ${
                        potionConfig.autoHealThresholdPct === pct
                          ? 'bg-emerald-600/30 border-emerald-400 text-emerald-200 font-bold'
                          : 'bg-[#141b2b] border-slate-700 text-slate-400'
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>,
      )}

      {wrapButton(
        'loot',
        <div className="relative">
          <button
            data-testid="hud-loot-btn"
            onPointerDown={(e) => {
              if (editMode) return;
              e.stopPropagation();
              fireImmediateAction('loot', onPickupLoot);
            }}
            onClick={(e) => {
              e.stopPropagation();
              fireImmediateAction('loot', onPickupLoot);
            }}
            className={`w-12 h-12 rounded-full bg-[#141a28]/92 border-2 text-amber-200 flex flex-col items-center justify-center shadow-lg active:scale-95 cursor-pointer touch-none select-none ${
              lootFilters.autoLootEnabled ? 'border-emerald-400/80' : 'border-amber-500/60'
            }`}
          >
            <Hand className="w-4 h-4 text-amber-300 pointer-events-none" />
            <span className="text-[9px] font-bold pointer-events-none">Recoger</span>
          </button>

          <button
            type="button"
            data-testid="hud-loot-config-btn"
            aria-label="Filtros de recolección"
            onPointerDown={(e) => {
              if (editMode) return;
              e.stopPropagation();
            }}
            onClick={(e) => {
              if (editMode) return;
              e.stopPropagation();
              setShowPotionMenu(false);
              setShowLootMenu((v) => !v);
            }}
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#0f1624] border border-amber-400/75 text-amber-200 flex items-center justify-center shadow cursor-pointer"
          >
            <SlidersHorizontal className="w-2.5 h-2.5 pointer-events-none" />
          </button>

          {showLootMenu && !editMode && (
            <div
              data-testid="hud-loot-menu"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="absolute right-14 bottom-0 w-52 rounded-xl bg-[#0d121d]/96 border border-amber-500/60 p-2.5 shadow-2xl space-y-2 z-30"
            >
              <div className="flex items-center justify-between text-[11px] font-bold text-amber-300">
                <span>Filtros de Recoger</span>
                <button
                  type="button"
                  onClick={() => setShowLootMenu(false)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <button
                type="button"
                onClick={() =>
                  onUpdateLootFilters({ ...lootFilters, autoLootEnabled: !lootFilters.autoLootEnabled })
                }
                className={`w-full px-2 py-1.5 rounded-lg border text-[10px] font-bold flex items-center justify-between cursor-pointer ${
                  lootFilters.autoLootEnabled
                    ? 'bg-emerald-600/25 border-emerald-400 text-emerald-200'
                    : 'bg-[#141b2b] border-slate-700 text-slate-400'
                }`}
              >
                <span>Auto-Recoger</span>
                <span>{lootFilters.autoLootEnabled ? 'ACTIVO' : 'MANUAL'}</span>
              </button>
              <div className="grid grid-cols-2 gap-1">
                {LOOT_FILTER_OPTIONS.map((opt) => {
                  const active = lootFilters[opt.key];
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => onUpdateLootFilters({ ...lootFilters, [opt.key]: !active })}
                      className={`px-2 py-1 rounded border text-[10px] flex items-center justify-between cursor-pointer ${
                        active
                          ? 'bg-[#172136] border-amber-500/60 font-semibold'
                          : 'bg-[#111622] border-slate-800 opacity-55'
                      }`}
                    >
                      <span className={opt.colorClass}>{opt.label}</span>
                      <span className="text-[9px] text-slate-200">{active ? '✓' : '—'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>,
      )}

      {wrapButton(
        'jump',
        <button
          onPointerDown={(e) => {
            if (editMode) return;
            e.stopPropagation();
            fireImmediateAction('jump', onJump);
          }}
          onClick={(e) => {
            e.stopPropagation();
            fireImmediateAction('jump', onJump);
          }}
          aria-label="Saltar (J)"
          className="w-14 h-14 rounded-full bg-[#131b2b]/95 border-2 border-amber-400/80 hover:border-amber-300 text-amber-200 flex flex-col items-center justify-center shadow-xl active:scale-95 cursor-pointer touch-none select-none"
        >
          <span className="text-[11px] font-extrabold leading-none pointer-events-none">SALTAR</span>
          <span className="text-[9px] font-mono-tabular text-amber-400 mt-0.5 pointer-events-none">J</span>
        </button>,
      )}

      {/* SEPARATED PODERES BUTTON + 10 SMALL SKILL/MAGIC SQUARES (5x2) */}
      {wrapButton(
        'skillTray',
        <div data-testid="hud-skill-tray" className="flex flex-col items-end gap-1 touch-none select-none">
          <div className="flex items-center gap-1">
            <button
              onPointerDown={(e) => {
                if (editMode) return;
                e.stopPropagation();
                fireImmediateAction('toggle_powers_grid', () => setPowersOpen((v) => !v));
              }}
              onClick={(e) => {
                e.stopPropagation();
                fireImmediateAction('toggle_powers_grid', () => setPowersOpen((v) => !v));
              }}
              className={`min-h-[30px] px-2.5 rounded-lg border text-[10px] font-bold inline-flex items-center gap-1 shadow-lg cursor-pointer touch-none select-none ${
                powersOpen
                  ? 'bg-amber-600/95 border-amber-300 text-slate-950'
                  : 'bg-[#0b1019]/92 border-amber-700/70 text-amber-200'
              }`}
            >
              <Flame className="w-3 h-3 pointer-events-none" />
              <span className="pointer-events-none">Poderes (10)</span>
            </button>

            <button
              onPointerDown={(e) => {
                if (editMode) return;
                e.stopPropagation();
                fireImmediateAction('assign_combo_mode', () => {
                  setPowersOpen(true);
                  setAssignComboMode((v) => !v);
                });
              }}
              onClick={(e) => {
                e.stopPropagation();
                fireImmediateAction('assign_combo_mode', () => {
                  setPowersOpen(true);
                  setAssignComboMode((v) => !v);
                });
              }}
              title="Elige hasta 5 poderes para el botón COMBO"
              className={`min-h-[30px] px-2 rounded-lg border text-[10px] font-bold cursor-pointer touch-none select-none ${
                assignComboMode
                  ? 'bg-rose-600 border-rose-300 text-white'
                  : 'bg-[#121826]/92 border-slate-600 text-slate-200'
              }`}
            >
              {assignComboMode
                ? `Editando Combo (${comboConfig.comboSkillIds.length}/5)`
                : `+Combo (${comboConfig.comboSkillIds.length}/5)`}
            </button>

            <button
              onPointerDown={(e) => {
                if (editMode) return;
                e.stopPropagation();
                fireImmediateAction('open_combo_picker', () => setShowComboPicker((v) => !v));
              }}
              onClick={(e) => {
                e.stopPropagation();
                fireImmediateAction('open_combo_picker', () => setShowComboPicker((v) => !v));
              }}
              title="Configurar ataque por defecto y Combo x5"
              className="w-8 h-[30px] rounded-lg bg-[#1b2234]/95 hover:bg-slate-700 border border-slate-600 text-amber-300 flex items-center justify-center cursor-pointer touch-none select-none"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 pointer-events-none" />
            </button>
          </div>

          {powersOpen && (
            <div className="grid grid-cols-5 gap-1 rounded-lg bg-[#0b1019]/92 border border-amber-700/60 p-1 shadow-xl">
              {classSkills.slice(0, 10).map((sk) => {
                const isDefault = sk.id === defaultSkill.id;
                const comboIdx = comboConfig.comboSkillIds.indexOf(sk.id);
                const rank = getSkillRank(character, sk.id);
                const cdRemaining = skillCooldowns[sk.id] ?? 0;
                return (
                  <button
                    key={sk.id}
                    onPointerDown={(e) => {
                      if (editMode) return;
                      e.stopPropagation();
                      if (assignComboMode) {
                        fireImmediateAction(`slot_${sk.id}`, () => toggleSkillInCombo(sk.id));
                      } else {
                        fireImmediateAction(`skill_${sk.id}`, () => onCastSkill(sk));
                      }
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (assignComboMode) {
                        fireImmediateAction(`slot_${sk.id}`, () => toggleSkillInCombo(sk.id));
                      } else {
                        fireImmediateAction(`skill_${sk.id}`, () => onCastSkill(sk));
                      }
                    }}
                    title={`${sk.name} Nv.${rank} (MP ${sk.mpCost})`}
                    style={{
                      borderColor:
                        assignComboMode && comboIdx >= 0
                          ? '#f43f5e'
                          : isDefault
                            ? '#f59e0b'
                            : 'rgba(71, 85, 105, 0.75)',
                    }}
                    className="relative w-9 h-9 rounded bg-[#151c2c] hover:bg-[#1f2940] border flex flex-col items-center justify-center text-center cursor-pointer active:scale-95 overflow-hidden touch-none select-none"
                  >
                    <span
                      style={{ backgroundColor: sk.badgeColor }}
                      className="w-2 h-2 rounded-sm mb-0.5 pointer-events-none"
                    />
                    <span className="text-[7.5px] font-bold text-slate-100 leading-none truncate max-w-[32px] pointer-events-none">
                      {sk.shortName}
                    </span>
                    <span className="text-[6.5px] font-mono-tabular text-amber-300/90 leading-none mt-0.5 pointer-events-none">
                      R{rank}
                    </span>
                    {comboIdx >= 0 && (
                      <span className="absolute -top-0.5 -right-0.5 px-1 rounded bg-rose-600 text-[7px] font-bold text-white pointer-events-none">
                        C{comboIdx + 1}
                      </span>
                    )}
                    {cdRemaining > 0.05 && (
                      <div className="absolute inset-0 bg-slate-950/78 flex items-center justify-center text-[9px] font-mono-tabular font-bold text-amber-300 pointer-events-none">
                        {cdRemaining.toFixed(1)}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>,
      )}

      {/* COMBO x5 TOGGLE BUTTON (Tap once to arm/disarm 5-power combo ONLY) */}
      {wrapButton(
        'combo',
        <button
          data-testid="hud-combo-btn"
          onPointerDown={(e) => {
            if (editMode) return;
            e.stopPropagation();
            fireImmediateAction('combo', onToggleComboArmed);
          }}
          onClick={(e) => {
            e.stopPropagation();
            fireImmediateAction('combo', onToggleComboArmed);
          }}
          className={`w-16 h-16 rounded-full border-2 flex flex-col items-center justify-center shadow-xl active:scale-95 cursor-pointer transition-colors touch-none select-none ${
            comboArmed
              ? 'bg-gradient-to-b from-rose-600 to-amber-600 border-amber-200 text-white'
              : 'bg-[#121826]/92 border-slate-500 text-slate-200'
          }`}
        >
          <Flame className={`w-5 h-5 pointer-events-none ${comboArmed ? 'text-amber-200' : 'text-slate-400'}`} />
          <span className="text-[9.5px] font-bold leading-tight pointer-events-none">
            {comboArmed ? 'COMBO ON' : 'COMBO'}
          </span>
          <span className="text-[8px] font-mono-tabular text-amber-200/90 pointer-events-none">
            {comboArmed ? 'x5 Listo' : `${comboConfig.comboSkillIds.slice(0, 5).length}/5`}
          </span>
        </button>,
      )}

      {/* DEDICATED HELLP AUTO-HUNT & AUTO-HEAL BUTTON */}
      {wrapButton(
        'hellp',
        <button
          data-testid="hud-hellp-btn"
          onPointerDown={(e) => {
            if (editMode) return;
            e.stopPropagation();
            fireImmediateAction('hellp', onToggleAutoHunt);
          }}
          onClick={(e) => {
            e.stopPropagation();
            fireImmediateAction('hellp', onToggleAutoHunt);
          }}
          className={`w-14 h-14 rounded-full border-2 flex flex-col items-center justify-center shadow-xl active:scale-95 cursor-pointer transition-colors touch-none select-none ${
            autoHuntEnabled
              ? 'bg-gradient-to-b from-emerald-600 to-teal-700 border-emerald-200 text-white'
              : 'bg-[#111926]/92 border-emerald-600/60 text-emerald-200'
          }`}
        >
          <Bot className={`w-4 h-4 pointer-events-none ${autoHuntEnabled ? 'text-white' : 'text-emerald-300'}`} />
          <span className="text-[9.5px] font-extrabold leading-tight pointer-events-none">
            {autoHuntEnabled ? 'Hellp ON' : 'Hellp'}
          </span>
          <span className="text-[7.5px] font-mono-tabular text-emerald-100/90 pointer-events-none">
            {autoHuntEnabled ? 'Auto+Cura' : 'Auto'}
          </span>
        </button>,
      )}

      {/* DEDICATED MAIN ATTACK BUTTON */}
      {wrapButton(
        'attack',
        <button
          data-testid="hud-attack-btn"
          onPointerDown={(e) => {
            if (editMode) return;
            e.stopPropagation();
            fireImmediateAction('attack', onPressAttack);
          }}
          onClick={(e) => {
            e.stopPropagation();
            fireImmediateAction('attack', onPressAttack);
          }}
          className={`w-20 h-20 rounded-full border-2 flex flex-col items-center justify-center shadow-2xl active:scale-95 cursor-pointer touch-none select-none ${
            comboArmed
              ? 'bg-gradient-to-b from-amber-500 to-rose-700 border-amber-200 text-white'
              : 'bg-gradient-to-b from-amber-500 to-amber-700 border-amber-200 text-slate-950'
          }`}
        >
          <Sword className="w-7 h-7 pointer-events-none" />
          <span className="text-[10px] font-extrabold leading-tight mt-0.5 max-w-[68px] truncate pointer-events-none">
            {comboArmed ? 'Atacar x5' : defaultSkill.shortName}
          </span>
        </button>,
      )}

      {/* SMALL MU ONLINE SKILL & 5-POWER COMBO CONFIGURATOR POPOVER */}
      {showComboPicker && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-3">
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto mu-scroll rounded-xl bg-[#0e131f] border-2 border-amber-700/80 p-4 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="font-display text-sm font-bold text-amber-300">
                10 Poderes y Combo x5 ({character.classType})
              </h3>
              <button
                onClick={() => setShowComboPicker(false)}
                className="min-h-[36px] min-w-[36px] rounded bg-slate-800 text-slate-200 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-slate-200">
                1. Ataque por Defecto (cuando COMBO está apagado)
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {classSkills.slice(0, 10).map((sk) => (
                  <button
                    key={sk.id}
                    onClick={() =>
                      onUpdateComboConfig({ ...comboConfig, defaultSkillId: sk.id })
                    }
                    className={`p-2 rounded-lg border text-left text-xs cursor-pointer ${
                      comboConfig.defaultSkillId === sk.id
                        ? 'bg-amber-600/25 border-amber-500 text-amber-200 font-bold'
                        : 'bg-[#141b2b] border-slate-800 text-slate-300'
                    }`}
                  >
                    <div>{sk.name}</div>
                    <div className="text-[10px] text-slate-400">
                      Daño x{sk.damageMultiplier} · MP {sk.mpCost}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2 pt-1 border-t border-slate-800">
              <div className="text-xs font-semibold text-rose-300">
                2. Cadena de Combo (5 poderes al activar el botón COMBO)
              </div>
              {([0, 1, 2, 3, 4] as const).map((stepIdx) => (
                <div key={stepIdx} className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono-tabular text-amber-300 shrink-0">
                    Paso {stepIdx + 1}:
                  </span>
                  <select
                    value={comboConfig.comboSkillIds[stepIdx] || classSkills[stepIdx + 1]?.id || classSkills[0].id}
                    onChange={(e) => cycleComboSlot(stepIdx, e.target.value)}
                    className="flex-1 min-h-[38px] rounded-lg bg-[#090d16] border border-slate-700 px-2.5 text-xs text-slate-100"
                  >
                    {classSkills.slice(0, 10).map((sk) => (
                      <option key={sk.id} value={sk.id}>
                        {sk.name} (x{sk.damageMultiplier})
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <button
              onClick={() => setShowComboPicker(false)}
              className="w-full min-h-[42px] rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs cursor-pointer"
            >
              Confirmar 5 Poderes de Combo
            </button>
          </div>
        </div>
      )}
    </>
  );
};
