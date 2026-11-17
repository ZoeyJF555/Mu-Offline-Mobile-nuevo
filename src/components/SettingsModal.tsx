import React from 'react';
import {
  Box,
  Maximize2,
  Move,
  Sliders,
  Sun,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { GameSettings } from '../types/game';

interface SettingsModalProps {
  open: boolean;
  settings: GameSettings;
  measuredFps: number;
  onClose: () => void;
  onUpdateSettings: (next: GameSettings) => void;
  onEnterButtonEditor: () => void;
  onRequestLandscapeFullscreen: () => void;
  onSwitchCharacter?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  settings,
  measuredFps,
  onClose,
  onUpdateSettings,
  onEnterButtonEditor,
  onRequestLandscapeFullscreen,
  onSwitchCharacter,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-3 sm:p-5">
      <div className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl bg-[#0f1420] border-2 border-amber-700/70 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-[#151c2c]">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-amber-400" />
            <h2 className="font-display text-base font-bold text-amber-300">
              Ajustes del Juego
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar ajustes"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-[#1d2537] hover:bg-slate-700 text-slate-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto mu-scroll p-4 space-y-4">
          {/* Brightness */}
          <div className="p-3.5 rounded-lg bg-[#141a28] border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-2 font-semibold text-slate-100">
                <Sun className="w-4 h-4 text-amber-400" />
                Brillo de Escena
              </span>
              <span className="font-mono-tabular text-amber-300">
                {Math.round(settings.brightness * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0.6}
              max={1.6}
              step={0.05}
              value={settings.brightness}
              onChange={(e) =>
                onUpdateSettings({ ...settings, brightness: Number(e.target.value) })
              }
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>

          {/* Sound Volume & Mute */}
          <div className="p-3.5 rounded-lg bg-[#141a28] border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-2 font-semibold text-slate-100">
                {settings.muted ? (
                  <VolumeX className="w-4 h-4 text-rose-400" />
                ) : (
                  <Volume2 className="w-4 h-4 text-sky-400" />
                )}
                Sonidos y Efectos
              </span>
              <div className="flex items-center gap-2">
                <span className="font-mono-tabular text-sky-300">
                  {settings.muted ? 'Silencio' : `${Math.round(settings.volume * 100)}%`}
                </span>
                <button
                  onClick={() => onUpdateSettings({ ...settings, muted: !settings.muted })}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 cursor-pointer"
                >
                  {settings.muted ? 'Activar' : 'Silenciar'}
                </button>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.volume}
              onChange={(e) =>
                onUpdateSettings({ ...settings, volume: Number(e.target.value), muted: false })
              }
              className="w-full accent-sky-500 cursor-pointer"
            />
          </div>

          {/* 3D Free-Orbit Camera Button */}
          <div className="p-3.5 rounded-lg bg-[#141a28] border border-slate-800 flex items-center justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-slate-100">
                <Box className="w-4 h-4 text-emerald-400" />
                Botón Tridimensional (Cámara 3D Libre)
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                {settings.free3dCamera
                  ? 'Activo: desliza en pantalla para girar 360° y ver el frente, alas y espalda del héroe.'
                  : 'Desactivado: cámara fija en 3ra persona detrás del personaje.'}
              </p>
            </div>
            <button
              onClick={() =>
                onUpdateSettings({ ...settings, free3dCamera: !settings.free3dCamera })
              }
              className={`min-h-[42px] px-4 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer ${
                settings.free3dCamera
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {settings.free3dCamera ? '3D Activado' : '3ra Persona'}
            </button>
          </div>

          {/* FPS Target */}
          <div className="p-3.5 rounded-lg bg-[#141a28] border border-slate-800 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-slate-100">
                Objetivo FPS (Actual: <span className="font-mono-tabular text-amber-300">{measuredFps} FPS</span>)
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Ajusta fluidez entre 30, 45 o 60 FPS según tu teléfono.
              </div>
            </div>
            <div className="flex items-center gap-1">
              {([30, 45, 60] as const).map((fps) => (
                <button
                  key={fps}
                  onClick={() => onUpdateSettings({ ...settings, targetFps: fps })}
                  className={`min-h-[38px] px-2.5 rounded text-xs font-mono-tabular font-bold cursor-pointer ${
                    settings.targetFps === fps
                      ? 'bg-amber-600 text-slate-950'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {fps}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Button Editor & Landscape Mode */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <button
              onClick={() => {
                onClose();
                onEnterButtonEditor();
              }}
              className="min-h-[46px] px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <Move className="w-4 h-4" />
              Ajustar Botones (Mover y Tamaño)
            </button>

            <button
              onClick={onRequestLandscapeFullscreen}
              className="min-h-[46px] px-4 rounded-lg bg-[#1a2438] hover:bg-slate-700 border border-slate-600 text-slate-100 font-semibold text-xs inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <Maximize2 className="w-4 h-4 text-amber-400" />
              Modo Horizontal Fullscreen
            </button>
          </div>

          {onSwitchCharacter && (
            <button
              onClick={onSwitchCharacter}
              className="w-full min-h-[44px] px-4 rounded-lg bg-[#161c2a] hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-xs cursor-pointer"
            >
              Cambiar Personaje / Cuenta
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
