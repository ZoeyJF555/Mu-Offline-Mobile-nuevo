import React, { useState } from 'react';
import { Hammer, Shield, Sparkles, Sword, X } from 'lucide-react';
import type { MuCharacter, MuItem } from '../types/game';

interface InventoryDrawerProps {
  open: boolean;
  character: MuCharacter;
  items: MuItem[];
  onClose: () => void;
  onEquip: (itemId: string) => void;
  onUpgrade: (itemId: string, jewel: 'bless' | 'soul') => void;
  forgeMessage: string | null;
}

export const InventoryDrawer: React.FC<InventoryDrawerProps> = ({
  open,
  character,
  items,
  onClose,
  onEquip,
  onUpgrade,
  forgeMessage,
}) => {
  const [filter, setFilter] = useState<'all' | 'equipped' | 'weapon' | 'armor'>('all');

  if (!open) return null;

  const filtered = items.filter((item) => {
    if (filter === 'equipped') return item.isEquipped;
    if (filter === 'weapon') return item.category === 'weapon';
    if (filter === 'armor') return item.category === 'armor' || item.category === 'wings';
    return true;
  });

  return (
    <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center bg-black/70 p-0 md:p-6">
      <div className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-t-2xl md:rounded-2xl bg-[#111622] border border-slate-700/80 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h2 className="font-display text-lg font-bold text-amber-300">
              Inventario y Forja de Lorencia
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 font-mono-tabular">
              {character.name} · Nivel {character.level} · Bless: {character.bless} · Soul: {character.soul} · Zen: {character.zen.toLocaleString()}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar inventario"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-[#1a2233] hover:bg-slate-700 text-slate-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter Bar */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 bg-[#0d111a] border-b border-slate-800 overflow-x-auto">
          <div className="flex items-center gap-1.5">
            {(
              [
                ['all', 'Todo'],
                ['equipped', 'Equipado'],
                ['weapon', 'Armas'],
                ['armor', 'Sets y Alas'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  filter === key
                    ? 'bg-amber-600 text-slate-950 font-semibold'
                    : 'bg-[#171e2e] text-slate-300 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-400 whitespace-nowrap shrink-0 font-mono-tabular">
            {items.length} ítems en SQLite
          </span>
        </div>

        {forgeMessage && (
          <div className="px-5 py-2.5 bg-amber-950/70 border-b border-amber-500/30 text-xs text-amber-200 font-medium">
            {forgeMessage}
          </div>
        )}

        {/* Item List */}
        <div className="flex-1 overflow-y-auto mu-scroll p-5 space-y-3">
          {filtered.map((item) => {
            const rarityColor =
              item.rarity === 'ancient'
                ? 'text-sky-300'
                : item.rarity === 'excellent'
                  ? 'text-emerald-300'
                  : 'text-slate-100';

            return (
              <div
                key={item.id}
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border transition-colors ${
                  item.isEquipped
                    ? 'bg-[#172030] border-amber-500/50'
                    : 'bg-[#141a26] border-slate-800'
                }`}
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {item.category === 'weapon' ? (
                      <Sword className="w-4 h-4 text-amber-400 shrink-0" />
                    ) : item.category === 'wings' ? (
                      <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />
                    ) : (
                      <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
                    )}
                    <span className={`font-semibold text-sm ${rarityColor}`}>
                      {item.name} +{item.enhanceLevel}
                    </span>
                    <span className="text-xs text-slate-400 font-mono-tabular">
                      · {item.isEquipped ? 'Equipado' : 'Mochila'}
                    </span>
                  </div>

                  <div className="text-xs text-slate-300 font-mono-tabular">
                    {item.minDmg > 0 && <span>Daño {item.minDmg}-{item.maxDmg} · </span>}
                    {item.magicPower > 0 && <span>Magia +{item.magicPower} · </span>}
                    {item.defense > 0 && <span>Defensa {item.defense} · </span>}
                    <span>Set {item.setName}</span>
                    {item.luck && <span> · Suerte +25%</span>}
                  </div>

                  <div className="text-xs text-slate-400">
                    {item.excellentOpt || 'Opción estándar'} · Propietario original: {item.originalOwner}
                    {item.sharedFromSession ? ` · Sala ${item.sharedFromSession}` : ''}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!item.isEquipped && (
                    <button
                      onClick={() => onEquip(item.id)}
                      className="min-h-[44px] px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold whitespace-nowrap cursor-pointer"
                    >
                      Equipar
                    </button>
                  )}
                  <button
                    onClick={() => onUpgrade(item.id, 'bless')}
                    disabled={character.bless <= 0 || item.enhanceLevel >= 6}
                    className="min-h-[44px] px-3 py-2 rounded-lg bg-rose-700/80 hover:bg-rose-600 disabled:opacity-40 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:cursor-not-allowed"
                    title="Mejora segura hasta +6 usando Jewel of Bless"
                  >
                    <Hammer className="w-3.5 h-3.5" />
                    +Bless
                  </button>
                  <button
                    onClick={() => onUpgrade(item.id, 'soul')}
                    disabled={character.soul <= 0 || item.enhanceLevel >= 13}
                    className="min-h-[44px] px-3 py-2 rounded-lg bg-blue-700/80 hover:bg-blue-600 disabled:opacity-40 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:cursor-not-allowed"
                    title="Mejora hasta +13 usando Jewel of Soul"
                  >
                    <Hammer className="w-3.5 h-3.5" />
                    +Soul
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
