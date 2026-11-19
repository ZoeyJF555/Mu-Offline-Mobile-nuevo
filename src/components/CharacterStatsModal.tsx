import React from 'react';
import { Plus, Shield, Sword, User, X } from 'lucide-react';
import type { MuCharacter, MuItem } from '../types/game';

interface CharacterStatsModalProps {
  open: boolean;
  character: MuCharacter;
  items: MuItem[];
  onClose: () => void;
  onAllocateStat: (stat: 'str' | 'agi' | 'vit' | 'ene' | 'cmd', amount: number) => void;
}

export const CharacterStatsModal: React.FC<CharacterStatsModalProps> = ({
  open,
  character,
  items,
  onClose,
  onAllocateStat,
}) => {
  if (!open) return null;

  const equipped = items.filter((i) => i.isEquipped && (i.durability ?? 100) > 0);
  const gearMinDmg = equipped.reduce((s, i) => s + i.minDmg, 0);
  const gearMaxDmg = equipped.reduce((s, i) => s + i.maxDmg, 0);
  const gearDef = equipped.reduce((s, i) => s + i.defense, 0);
  const gearMagic = equipped.reduce((s, i) => s + i.magicPower, 0);

  const minDmg = Math.round(character.str * 0.65 + gearMinDmg);
  const maxDmg = Math.round(character.str * 0.95 + gearMaxDmg);
  const totalDef = Math.round(character.agi * 0.45 + gearDef);
  const totalMagic = Math.round(character.ene * 0.8 + gearMagic);

  const statRows: Array<{
    key: 'str' | 'agi' | 'vit' | 'ene' | 'cmd';
    label: string;
    value: number;
    hint: string;
  }> = [
    { key: 'str', label: 'Fuerza (STR)', value: character.str, hint: 'Aumenta daño físico cuerpo a cuerpo' },
    { key: 'agi', label: 'Agilidad (AGI)', value: character.agi, hint: 'Aumenta defensa y velocidad de ataque' },
    { key: 'vit', label: 'Vitalidad (VIT)', value: character.vit, hint: 'Aumenta HP máximo (+6 por punto)' },
    { key: 'ene', label: 'Energía (ENE)', value: character.ene, hint: 'Aumenta daño mágico y MP (+5 por punto)' },
    ...(character.classType === 'DL'
      ? [{ key: 'cmd' as const, label: 'Comando (CMD)', value: character.cmd, hint: 'Potencia Cuervo y Dark Horse del DL' }]
      : []),
  ];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-3">
      <div className="w-full max-w-lg rounded-xl bg-[#0d121d] border-2 border-amber-700/80 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-[#161d2e] border-b border-amber-700/50">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-amber-400" />
            <h2 className="font-display text-sm sm:text-base font-bold text-amber-300">
              Atributos del Personaje (C) · {character.name}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar Atributos"
            className="min-h-[38px] min-w-[38px] rounded-lg bg-[#1d2538] hover:bg-slate-700 text-slate-200 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between p-3 rounded-lg bg-[#131928] border border-amber-500/40">
            <div>
              <div className="text-xs text-slate-300 font-mono-tabular">
                {character.classType} · Nivel {character.level} · Kills {character.kills}
              </div>
              <div className="text-[11px] text-slate-400">
                XP: {character.xp} / {character.xpToNext}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-slate-400">Puntos Libres</div>
              <div className="text-lg font-bold font-mono-tabular text-amber-300">
                {character.unspentPoints}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {statRows.map((row) => (
              <div
                key={row.key}
                className="p-2.5 rounded-lg bg-[#111624] border border-slate-800 flex items-center justify-between gap-2"
              >
                <div>
                  <div className="text-xs font-bold text-slate-100">
                    {row.label}:{' '}
                    <span className="font-mono-tabular text-amber-300">{row.value}</span>
                  </div>
                  <div className="text-[10px] text-slate-400">{row.hint}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {[1, 5].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => onAllocateStat(row.key, amt)}
                      disabled={character.unspentPoints <= 0}
                      className="min-h-[36px] px-2.5 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-35 text-slate-950 font-bold text-xs inline-flex items-center gap-0.5 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      {amt}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1 text-center font-mono-tabular">
            <div className="p-2 rounded-lg bg-[#141a28] border border-slate-800">
              <div className="text-[10px] text-slate-400 inline-flex items-center gap-1">
                <Sword className="w-3 h-3 text-rose-400" />
                Ataque
              </div>
              <div className="text-xs font-bold text-slate-100">
                {minDmg}~{maxDmg}
              </div>
            </div>
            <div className="p-2 rounded-lg bg-[#141a28] border border-slate-800">
              <div className="text-[10px] text-slate-400 inline-flex items-center gap-1">
                <Shield className="w-3 h-3 text-emerald-400" />
                Defensa
              </div>
              <div className="text-xs font-bold text-slate-100">{totalDef}</div>
            </div>
            <div className="p-2 rounded-lg bg-[#141a28] border border-slate-800">
              <div className="text-[10px] text-slate-400">Magia</div>
              <div className="text-xs font-bold text-sky-300">+{totalMagic}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
