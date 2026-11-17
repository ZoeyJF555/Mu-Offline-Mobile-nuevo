import React, { useState } from 'react';
import { Hammer, Shield, Sparkles, Sword, X } from 'lucide-react';
import type { ItemSlot, MuCharacter, MuItem } from '../types/game';

interface MuInventoryModalProps {
  open: boolean;
  character: MuCharacter;
  items: MuItem[];
  onClose: () => void;
  onEquip: (itemId: string) => void;
  onUpgrade: (itemId: string, jewel: 'bless' | 'soul') => void;
  forgeMessage: string | null;
}

const PAPER_DOLL_SLOTS: Array<{ slot: ItemSlot; label: string; gridArea: string }> = [
  { slot: 'helm', label: 'Yelmo', gridArea: 'col-start-2 row-start-1' },
  { slot: 'wings', label: 'Alas / Capa', gridArea: 'col-start-3 row-start-1' },
  { slot: 'weapon', label: 'Arma Der.', gridArea: 'col-start-1 row-start-2' },
  { slot: 'armor', label: 'Armadura', gridArea: 'col-start-2 row-start-2' },
  { slot: 'shield', label: 'Escudo / Izq', gridArea: 'col-start-3 row-start-2' },
  { slot: 'gloves', label: 'Guantes', gridArea: 'col-start-1 row-start-3' },
  { slot: 'pants', label: 'Pantalón', gridArea: 'col-start-2 row-start-3' },
  { slot: 'boots', label: 'Botas', gridArea: 'col-start-3 row-start-3' },
];

export const MuInventoryModal: React.FC<MuInventoryModalProps> = ({
  open,
  character,
  items,
  onClose,
  onEquip,
  onUpgrade,
  forgeMessage,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!open) return null;

  const equippedBySlot = new Map<ItemSlot, MuItem>();
  const backpackItems: MuItem[] = [];
  for (const it of items) {
    if (it.isEquipped && !equippedBySlot.has(it.slot)) {
      equippedBySlot.set(it.slot, it);
    } else {
      backpackItems.push(it);
    }
  }

  const selectedItem = items.find((i) => i.id === selectedId) || items[0] || null;
  const totalSlots = 24; // 6x4 classic grid

  const getRarityStyle = (rarity: MuItem['rarity']) => {
    if (rarity === 'ancient') return 'border-sky-500/80 bg-sky-950/60 text-sky-200';
    if (rarity === 'excellent') return 'border-emerald-500/80 bg-emerald-950/55 text-emerald-200';
    return 'border-amber-700/60 bg-[#181e2c] text-slate-100';
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-2 sm:p-4">
      <div className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-xl bg-[#0d111a] border-2 border-amber-700/80 shadow-2xl overflow-hidden">
        {/* Classic MU Window Title Bar */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-[#231912] via-[#191d2b] to-[#121622] border-b border-amber-700/60">
          <div>
            <h2 className="font-display text-sm sm:text-base font-bold text-amber-300">
              Inventario (V) · {character.name} ({character.classType} Nv.{character.level})
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar Inventario"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-[#1d2434] hover:bg-slate-700 text-slate-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {forgeMessage && (
          <div className="px-4 py-2 bg-amber-950/80 border-b border-amber-500/40 text-xs text-amber-200 font-medium">
            {forgeMessage}
          </div>
        )}

        {/* Main 2-Column MU Layout: Left Paper-Doll + Right Grid & Tooltip */}
        <div className="flex-1 overflow-y-auto mu-scroll p-3 sm:p-4 grid grid-cols-1 md:grid-cols-12 gap-4">
          {/* Left: Equipment Paper Doll */}
          <div className="md:col-span-5 bg-[#090c14] border border-slate-800 rounded-lg p-3 flex flex-col justify-between">
            <div>
              <div className="text-[11px] font-semibold text-amber-300/90 mb-2 text-center">
                Equipo Actual ({character.classType})
              </div>
              <div className="grid grid-cols-3 grid-rows-3 gap-2">
                {PAPER_DOLL_SLOTS.map(({ slot, label, gridArea }) => {
                  const eq = equippedBySlot.get(slot);
                  const active = eq && selectedItem?.id === eq.id;
                  return (
                    <button
                      key={slot}
                      onClick={() => eq && setSelectedId(eq.id)}
                      className={`${gridArea} min-h-[68px] p-1.5 rounded-lg border text-center flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer ${
                        eq ? getRarityStyle(eq.rarity) : 'border-slate-800 bg-[#0d121d] text-slate-600'
                      } ${active ? 'ring-2 ring-amber-400' : ''}`}
                    >
                      {eq ? (
                        <>
                          {eq.category === 'weapon' ? (
                            <Sword className="w-4 h-4 text-amber-300" />
                          ) : eq.category === 'wings' ? (
                            <Sparkles className="w-4 h-4 text-sky-300" />
                          ) : (
                            <Shield className="w-4 h-4 text-emerald-300" />
                          )}
                          <span className="text-[10px] font-semibold leading-tight line-clamp-2">
                            {eq.name}
                          </span>
                          <span className="text-[10px] font-mono-tabular text-amber-300">
                            +{eq.enhanceLevel}
                          </span>
                        </>
                      ) : (
                        <span className="text-[10px]">{label}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Bottom MU Currencies Strip */}
            <div className="mt-3 pt-2.5 border-t border-slate-800 grid grid-cols-4 gap-1.5 text-center font-mono-tabular">
              <div className="p-1.5 rounded bg-[#121724] border border-slate-800">
                <div className="text-[10px] text-slate-400">Zen</div>
                <div className="text-xs font-bold text-amber-300">{character.zen.toLocaleString()}</div>
              </div>
              <div className="p-1.5 rounded bg-[#121724] border border-slate-800">
                <div className="text-[10px] text-rose-300">Bless</div>
                <div className="text-xs font-bold text-rose-200">{character.bless}</div>
              </div>
              <div className="p-1.5 rounded bg-[#121724] border border-slate-800">
                <div className="text-[10px] text-sky-300">Soul</div>
                <div className="text-xs font-bold text-sky-200">{character.soul}</div>
              </div>
              <div className="p-1.5 rounded bg-[#121724] border border-slate-800">
                <div className="text-[10px] text-amber-200">Chaos</div>
                <div className="text-xs font-bold text-amber-100">{character.chaos}</div>
              </div>
            </div>
          </div>

          {/* Right: 6x4 MU Grid + Selected Item Tooltip */}
          <div className="md:col-span-7 flex flex-col gap-3">
            <div className="bg-[#090c14] border border-slate-800 rounded-lg p-3">
              <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
                <span>Mochila (SQLite · {backpackItems.length} ítems guardados)</span>
                <span>Toca un cuadro para equipar o forjar</span>
              </div>
              <div className="grid grid-cols-6 gap-1.5">
                {Array.from({ length: totalSlots }).map((_, idx) => {
                  const it = backpackItems[idx];
                  const active = it && selectedItem?.id === it.id;
                  return (
                    <button
                      key={idx}
                      onClick={() => it && setSelectedId(it.id)}
                      className={`min-h-[54px] p-1 rounded border flex flex-col items-center justify-center text-center transition-colors ${
                        it
                          ? `${getRarityStyle(it.rarity)} cursor-pointer`
                          : 'border-slate-800/80 bg-[#0d111a] cursor-default'
                      } ${active ? 'ring-2 ring-amber-400' : ''}`}
                    >
                      {it && (
                        <>
                          {it.category === 'weapon' ? (
                            <Sword className="w-3.5 h-3.5 text-amber-300" />
                          ) : it.category === 'wings' ? (
                            <Sparkles className="w-3.5 h-3.5 text-sky-300" />
                          ) : (
                            <Shield className="w-3.5 h-3.5 text-emerald-300" />
                          )}
                          <span className="text-[9px] font-semibold leading-tight truncate w-full mt-0.5">
                            +{it.enhanceLevel} {it.name.split(' ')[0]}
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Classic MU Item Tooltip Inspector */}
            {selectedItem && (
              <div className="p-3.5 rounded-lg bg-[#080d18] border border-amber-500/50 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-bold text-amber-300">
                    {selectedItem.name} +{selectedItem.enhanceLevel}
                  </div>
                  <span className="text-[11px] font-mono-tabular text-slate-400">
                    {selectedItem.isEquipped ? 'Equipado' : 'En Mochila'} · {selectedItem.rarity.toUpperCase()}
                  </span>
                </div>

                <div className="text-xs text-slate-200 font-mono-tabular">
                  {selectedItem.minDmg > 0 && <span>Daño: {selectedItem.minDmg}~{selectedItem.maxDmg} · </span>}
                  {selectedItem.magicPower > 0 && <span>Magia: +{selectedItem.magicPower} · </span>}
                  {selectedItem.defense > 0 && <span>Defensa: {selectedItem.defense} · </span>}
                  <span>Set: {selectedItem.setName}</span>
                </div>

                <div className="text-xs text-emerald-300">
                  {selectedItem.luck ? 'Suerte (Crítico +5% / Joya +25%)' : 'Sin Suerte'}
                  {selectedItem.excellentOpt ? ` · ${selectedItem.excellentOpt}` : ''}
                </div>

                <div className="text-[11px] text-slate-400">
                  Propietario original: {selectedItem.originalOwner}
                  {selectedItem.sharedFromSession ? ` · Compartido en sala ${selectedItem.sharedFromSession}` : ''}
                </div>

                <div className="flex items-center gap-2 pt-1 flex-wrap">
                  {!selectedItem.isEquipped && (
                    <button
                      onClick={() => onEquip(selectedItem.id)}
                      className="min-h-[42px] px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs cursor-pointer"
                    >
                      Equipar en Personaje
                    </button>
                  )}
                  <button
                    onClick={() => onUpgrade(selectedItem.id, 'bless')}
                    disabled={character.bless <= 0 || selectedItem.enhanceLevel >= 6}
                    className="min-h-[42px] px-3.5 rounded-lg bg-rose-700 hover:bg-rose-600 disabled:opacity-40 text-white font-semibold text-xs inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Hammer className="w-3.5 h-3.5" />
                    Subir +Bless
                  </button>
                  <button
                    onClick={() => onUpgrade(selectedItem.id, 'soul')}
                    disabled={character.soul <= 0 || selectedItem.enhanceLevel >= 13}
                    className="min-h-[42px] px-3.5 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white font-semibold text-xs inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Hammer className="w-3.5 h-3.5" />
                    Subir +Soul
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
