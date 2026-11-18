import React, { useRef, useState } from 'react';
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
  SlidersHorizontal,
  Smartphone,
  Sword,
  User,
  Wifi,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { DEFAULT_BUTTON_LAYOUTS, MU_SKILLS } from '../data/muSkillsAndClasses';
import { getMapById } from '../data/muWorldData';
import type {
  ButtonLayoutItem,
  CharacterComboConfig,
  HudButtonId,
  MuCharacter,
  NpcDef,
  SkillDef,
} from '../types/game';
import { PubgJoystick } from './PubgJoystick';

interface MuHudOverlayProps {
  character: MuCharacter;
  comboConfig: CharacterComboConfig;
  comboArmed: boolean;
  buttonLayouts: Record<HudButtonId, ButtonLayoutItem>;
  editMode: boolean;
  measuredFps: number;
  free3dCamera: boolean;
  nearbyNpc: NpcDef | null;
  onJoystickVector: (x: number, y: number) => void;
  onPressAttack: () => void;
  onToggleComboArmed: () => void;
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

export const MuHudOverlay: React.FC<MuHudOverlayProps> = ({
  character,
  comboConfig,
  comboArmed,
  buttonLayouts,
  editMode,
  measuredFps,
  free3dCamera,
  nearbyNpc,
  onJoystickVector,
  onPressAttack,
  onToggleComboArmed,
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
  const dragState = useRef<{
    id: HudButtonId;
    pointerId: number;
    startX: number;
    startY: number;
    origXPct: number;
    origYPct: number;
  } | null>(null);

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

  const cycleComboSlot = (slotIdx: 0 | 1 | 2, skillId: string) => {
    const next: [string, string, string] = [...comboConfig.comboSkillIds] as [string, string, string];
    next[slotIdx] = skillId;
    onUpdateComboConfig({ ...comboConfig, comboSkillIds: next });
  };

  return (
    <>
      {/* TOP-LEFT: Compact Character, Current Map & FPS Readout */}
      <div className="pointer-events-none fixed top-2.5 left-3 z-20 rounded-lg bg-[#0d121c]/90 border border-amber-700/50 px-3 py-1.5 shadow-lg">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-display font-bold text-amber-300">{character.name}</span>
          <span className="font-mono-tabular text-slate-300">
            {character.classType} Nv.{character.level}
          </span>
          <span className="font-mono-tabular text-sky-300">· {mapCfg.name}</span>
          <span className="font-mono-tabular text-emerald-300">{measuredFps} FPS</span>
          {free3dCamera && (
            <span className="font-mono-tabular text-purple-300">· 3D Libre</span>
          )}
        </div>
      </div>

      {/* TOP-LEFT SECONDARY: Quick Oracle & APK Buttons */}
      {!editMode && (
        <div className="fixed top-12 left-3 z-20 flex items-center gap-1.5">
          <button
            onClick={onOpenOracle}
            className="min-h-[36px] px-2.5 rounded-lg bg-[#0e1420]/90 border border-slate-700 hover:border-emerald-500/60 text-emerald-300 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
          >
            <Bot className="w-3.5 h-3.5" />
            Oráculo
          </button>
          <button
            onClick={onOpenApk}
            className="min-h-[36px] px-2.5 rounded-lg bg-[#0e1420]/90 border border-slate-700 hover:border-amber-500/60 text-amber-200 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
          >
            <Smartphone className="w-3.5 h-3.5" />
            APK / SQLite
          </button>
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

      {/* DRAGGABLE & SCALABLE HUD BUTTONS */}
      {wrapButton(
        'mapWarp',
        <button
          onClick={() => !editMode && onOpenMapWarp()}
          className="min-h-[42px] px-2.5 rounded-lg bg-[#0f1522]/92 border border-emerald-600/50 hover:border-emerald-400 text-emerald-200 text-xs font-semibold inline-flex items-center gap-1.5 shadow-lg cursor-pointer whitespace-nowrap"
        >
          <Compass className="w-4 h-4 text-emerald-400" />
          15 Mapas
        </button>,
      )}

      {wrapButton(
        'stats',
        <button
          onClick={() => !editMode && onOpenStats()}
          className="relative min-h-[42px] px-2.5 rounded-lg bg-[#0f1522]/92 border border-purple-500/50 hover:border-purple-400 text-purple-200 text-xs font-semibold inline-flex items-center gap-1.5 shadow-lg cursor-pointer whitespace-nowrap"
        >
          <User className="w-4 h-4 text-purple-300" />
          Stats
          {character.unspentPoints > 0 && (
            <span className="px-1.5 py-0.2 rounded bg-amber-500 text-slate-950 text-[10px] font-bold">
              +{character.unspentPoints}
            </span>
          )}
        </button>,
      )}

      {wrapButton(
        'sync',
        <button
          onClick={() => !editMode && onOpenSync()}
          className="min-h-[42px] px-2.5 rounded-lg bg-[#0f1522]/92 border border-sky-600/50 hover:border-sky-400 text-sky-200 text-xs font-semibold inline-flex items-center gap-1.5 shadow-lg cursor-pointer whitespace-nowrap"
        >
          <Wifi className="w-4 h-4 text-sky-400" />
          Wi-Fi / BT
        </button>,
      )}

      {wrapButton(
        'inventory',
        <button
          onClick={() => !editMode && onOpenInventory()}
          className="min-h-[42px] px-2.5 rounded-lg bg-[#0f1522]/92 border border-amber-600/60 hover:border-amber-400 text-amber-200 text-xs font-semibold inline-flex items-center gap-1.5 shadow-lg cursor-pointer whitespace-nowrap"
        >
          <Backpack className="w-4 h-4 text-amber-400" />
          Inventario
        </button>,
      )}

      {wrapButton(
        'settings',
        <button
          onClick={() => !editMode && onOpenSettings()}
          aria-label="Ajustes"
          className="min-h-[44px] min-w-[44px] rounded-lg bg-[#0f1522]/92 border border-slate-600 hover:border-amber-400 text-slate-100 flex items-center justify-center shadow-lg cursor-pointer"
        >
          <Settings className="w-5 h-5 text-amber-300" />
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
        <button
          onClick={() => !editMode && onHealPotion()}
          className="w-12 h-12 rounded-full bg-[#1a0f14]/92 border-2 border-rose-500/70 text-rose-200 flex flex-col items-center justify-center shadow-lg active:scale-95 cursor-pointer"
        >
          <Heart className="w-4 h-4 text-rose-400" />
          <span className="text-[9px] font-bold">HP/MP</span>
        </button>,
      )}

      {wrapButton(
        'loot',
        <button
          onClick={() => !editMode && onPickupLoot()}
          className="w-12 h-12 rounded-full bg-[#141a28]/92 border-2 border-amber-500/60 text-amber-200 flex flex-col items-center justify-center shadow-lg active:scale-95 cursor-pointer"
        >
          <Hand className="w-4 h-4 text-amber-300" />
          <span className="text-[9px] font-bold">Recoger</span>
        </button>,
      )}

      {/* MU Online 6-Skill Selector Mini-Windows */}
      {wrapButton(
        'skillTray',
        <div className="flex items-center gap-1 rounded-lg bg-[#0b1019]/92 border border-amber-700/60 p-1 shadow-xl">
          {classSkills.map((sk) => {
            const isDefault = sk.id === defaultSkill.id;
            const comboIdx = comboConfig.comboSkillIds.indexOf(sk.id);
            return (
              <button
                key={sk.id}
                onClick={() => !editMode && onCastSkill(sk)}
                title={`${sk.name} (MP ${sk.mpCost})`}
                style={{ borderColor: isDefault ? '#f59e0b' : 'rgba(71, 85, 105, 0.7)' }}
                className="relative w-10 h-10 rounded bg-[#151c2c] hover:bg-[#1f2940] border flex flex-col items-center justify-center text-center cursor-pointer active:scale-95"
              >
                <span
                  style={{ backgroundColor: sk.badgeColor }}
                  className="w-2 h-2 rounded-sm mb-0.5"
                />
                <span className="text-[8px] font-bold text-slate-100 leading-none truncate max-w-[34px]">
                  {sk.shortName}
                </span>
                {comboIdx >= 0 && (
                  <span className="absolute -top-1 -right-1 px-1 rounded bg-rose-600 text-[8px] font-bold text-white">
                    C{comboIdx + 1}
                  </span>
                )}
              </button>
            );
          })}
          <button
            onClick={() => !editMode && setShowComboPicker((v) => !v)}
            title="Configurar ataque por defecto y Combo x3"
            className="w-8 h-10 rounded bg-[#1b2234] hover:bg-slate-700 border border-slate-600 text-amber-300 flex items-center justify-center cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>,
      )}

      {/* COMBO x3 TOGGLE BUTTON */}
      {wrapButton(
        'combo',
        <button
          onClick={() => !editMode && onToggleComboArmed()}
          className={`w-16 h-16 rounded-full border-2 flex flex-col items-center justify-center shadow-xl active:scale-95 cursor-pointer transition-colors ${
            comboArmed
              ? 'bg-gradient-to-b from-rose-600 to-amber-600 border-amber-200 text-white'
              : 'bg-[#121826]/92 border-slate-500 text-slate-200'
          }`}
        >
          <Flame className={`w-5 h-5 ${comboArmed ? 'text-amber-200' : 'text-slate-400'}`} />
          <span className="text-[10px] font-bold leading-tight">
            {comboArmed ? 'COMBO ON' : 'COMBO'}
          </span>
        </button>,
      )}

      {/* DEDICATED MAIN ATTACK BUTTON */}
      {wrapButton(
        'attack',
        <button
          onClick={() => !editMode && onPressAttack()}
          className={`w-20 h-20 rounded-full border-2 flex flex-col items-center justify-center shadow-2xl active:scale-95 cursor-pointer ${
            comboArmed
              ? 'bg-gradient-to-b from-amber-500 to-rose-700 border-amber-200 text-white'
              : 'bg-gradient-to-b from-amber-500 to-amber-700 border-amber-200 text-slate-950'
          }`}
        >
          <Sword className="w-7 h-7" />
          <span className="text-[10px] font-extrabold leading-tight mt-0.5 max-w-[68px] truncate">
            {comboArmed ? 'Atacar x3' : defaultSkill.shortName}
          </span>
        </button>,
      )}

      {/* AUTHENTIC MU ONLINE BOTTOM HP/MP GLOBES + SD/AG/XP BAR */}
      <div className="pointer-events-none fixed bottom-0 left-1/2 -translate-x-1/2 z-10 flex items-end gap-1 sm:gap-2 pb-1">
        <div className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#130b0d] border-2 border-amber-700/90 overflow-hidden shadow-2xl flex items-center justify-center">
          <div
            className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-rose-800 via-rose-600 to-red-500 transition-all"
            style={{ height: `${hpPct}%` }}
          />
          <span className="relative z-10 text-[10px] font-mono-tabular font-bold text-white drop-shadow">
            {character.hp}
          </span>
        </div>

        <div className="w-44 sm:w-64 rounded-t-lg bg-[#0d111a]/95 border border-b-0 border-amber-700/70 px-2.5 py-1.5 space-y-1 shadow-xl">
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <div className="flex justify-between text-[9px] font-mono-tabular text-amber-200">
                <span>SD</span>
                <span>{character.sd}</span>
              </div>
              <div className="h-1.5 rounded bg-slate-800 overflow-hidden">
                <div className="h-full bg-amber-400" style={{ width: `${sdPct}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[9px] font-mono-tabular text-purple-200">
                <span>AG</span>
                <span>{character.ag}</span>
              </div>
              <div className="h-1.5 rounded bg-slate-800 overflow-hidden">
                <div className="h-full bg-purple-500" style={{ width: `${agPct}%` }} />
              </div>
            </div>
          </div>

          <div className="h-1.5 w-full rounded bg-slate-900 border border-slate-700 overflow-hidden">
            <div className="h-full bg-amber-500 transition-all" style={{ width: `${xpPct}%` }} />
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono-tabular text-slate-300">
            <span>Zen {character.zen.toLocaleString()}</span>
            <span className="text-rose-300">B:{character.bless}</span>
            <span className="text-sky-300">S:{character.soul}</span>
          </div>
        </div>

        <div className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#09101a] border-2 border-amber-700/90 overflow-hidden shadow-2xl flex items-center justify-center">
          <div
            className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-blue-900 via-blue-600 to-sky-400 transition-all"
            style={{ height: `${mpPct}%` }}
          />
          <span className="relative z-10 text-[10px] font-mono-tabular font-bold text-white drop-shadow">
            {character.mp}
          </span>
        </div>
      </div>

      {/* SMALL MU ONLINE SKILL & COMBO CONFIGURATOR POPOVER */}
      {showComboPicker && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-3">
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto mu-scroll rounded-xl bg-[#0e131f] border-2 border-amber-700/80 p-4 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="font-display text-sm font-bold text-amber-300">
                Ventana de Ataques y Combo x3 ({character.classType})
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
                {classSkills.map((sk) => (
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
                2. Cadena de Combo (3 ataques al activar botón COMBO)
              </div>
              {([0, 1, 2] as const).map((stepIdx) => (
                <div key={stepIdx} className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono-tabular text-amber-300 shrink-0">
                    Paso {stepIdx + 1}:
                  </span>
                  <select
                    value={comboConfig.comboSkillIds[stepIdx]}
                    onChange={(e) => cycleComboSlot(stepIdx, e.target.value)}
                    className="flex-1 min-h-[38px] rounded-lg bg-[#090d16] border border-slate-700 px-2.5 text-xs text-slate-100"
                  >
                    {classSkills.map((sk) => (
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
              Confirmar Habilidades
            </button>
          </div>
        </div>
      )}
    </>
  );
};
