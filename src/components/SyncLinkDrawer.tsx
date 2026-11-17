import React, { useState } from 'react';
import {
  ArrowLeftRight,
  Bluetooth,
  Check,
  Copy,
  History,
  Swords,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import type {
  EventSessionRecord,
  EventType,
  MuCharacter,
  MuItem,
  RoomState,
  SharedLedgerEntry,
  TransportMode,
} from '../types/game';

interface SyncLinkDrawerProps {
  open: boolean;
  character: MuCharacter;
  items: MuItem[];
  localPeerId: string;
  wsConnected: boolean;
  roomState: RoomState | null;
  bluetoothDeviceName: string | null;
  ledger: SharedLedgerEntry[];
  eventHistory: EventSessionRecord[];
  statusMessage: string | null;
  onClose: () => void;
  onPairBluetooth: () => Promise<void>;
  onCreateRoom: (eventType: EventType, transport: TransportMode) => Promise<void>;
  onJoinRoom: (code: string, transport: TransportMode) => Promise<void>;
  onStartEvent: (eventType: EventType) => void;
  onSendItemToPeer: (targetPeerId: string, item: MuItem) => void;
  onEndRoom: () => void;
}

const EVENT_LABELS: Record<EventType, string> = {
  blood_castle: 'Blood Castle (Asalto Cooperativo)',
  chaos_castle: 'Chaos Castle (Supervivencia)',
  kundun_boss: 'Invasión del Señor Kundun',
  free_trade: 'Mercado Libre de Armas y Sets',
};

export const SyncLinkDrawer: React.FC<SyncLinkDrawerProps> = ({
  open,
  character,
  items,
  localPeerId,
  wsConnected,
  roomState,
  bluetoothDeviceName,
  ledger,
  eventHistory,
  statusMessage,
  onClose,
  onPairBluetooth,
  onCreateRoom,
  onJoinRoom,
  onStartEvent,
  onSendItemToPeer,
  onEndRoom,
}) => {
  const [tab, setTab] = useState<'link' | 'trade' | 'history'>('link');
  const [transport, setTransport] = useState<TransportMode>('wifi');
  const [eventType, setEventType] = useState<EventType>('blood_castle');
  const [joinCode, setJoinCode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('sala') || '';
  });
  const [selectedPeerId, setSelectedPeerId] = useState<string>('');
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const remotePeers = (roomState?.peers || []).filter((p) => p.peerId !== localPeerId);
  const activeTargetPeerId =
    selectedPeerId && remotePeers.some((p) => p.peerId === selectedPeerId)
      ? selectedPeerId
      : remotePeers[0]?.peerId || '';

  const inviteUrl = roomState
    ? `${window.location.origin}/?sala=${encodeURIComponent(roomState.code)}`
    : '';

  const copyInviteLink = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback ignored
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center bg-black/75 p-0 md:p-6">
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-t-2xl md:rounded-2xl bg-[#111622] border border-slate-700/80 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h2 className="font-display text-lg font-bold text-amber-300">
              Vinculación Local Wi-Fi y Bluetooth · Intercambio en Tiempo Real
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Invita amigos a eventos y comparte armas o sets; cada cambio se guarda al instante en SQLite sin perder nada al cerrar la sala.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar vinculación"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-[#1a2233] hover:bg-slate-700 text-slate-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sub-navigation Tabs */}
        <div className="flex items-center gap-2 px-5 py-3 bg-[#0d111a] border-b border-slate-800 overflow-x-auto">
          <button
            onClick={() => setTab('link')}
            className={`min-h-[42px] px-4 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
              tab === 'link' ? 'bg-amber-600 text-slate-950' : 'bg-[#171e2e] text-slate-300 hover:text-white'
            }`}
          >
            <Users className="w-4 h-4" />
            Sala y Eventos ({roomState ? roomState.peers.length : 0})
          </button>
          <button
            onClick={() => setTab('trade')}
            className={`min-h-[42px] px-4 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
              tab === 'trade' ? 'bg-amber-600 text-slate-950' : 'bg-[#171e2e] text-slate-300 hover:text-white'
            }`}
          >
            <ArrowLeftRight className="w-4 h-4" />
            Cambiar Armas y Sets
          </button>
          <button
            onClick={() => setTab('history')}
            className={`min-h-[42px] px-4 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
              tab === 'history' ? 'bg-amber-600 text-slate-950' : 'bg-[#171e2e] text-slate-300 hover:text-white'
            }`}
          >
            <History className="w-4 h-4" />
            Historial Persistente ({ledger.length})
          </button>
        </div>

        {statusMessage && (
          <div className="px-5 py-2.5 bg-sky-950/70 border-b border-sky-500/30 text-xs text-sky-200">
            {statusMessage}
          </div>
        )}

        <div className="flex-1 overflow-y-auto mu-scroll p-5 space-y-5">
          {tab === 'link' && (
            <>
              {/* Transport Selector */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={() => setTransport('wifi')}
                  className={`p-4 rounded-xl border text-left transition-colors cursor-pointer ${
                    transport === 'wifi'
                      ? 'bg-[#192338] border-amber-500/70'
                      : 'bg-[#141a26] border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 font-semibold text-sm text-slate-100">
                      <Wifi className="w-4 h-4 text-sky-400" />
                      Wi-Fi Local / Misma Red
                    </span>
                    <span className="text-xs text-slate-400">
                      {wsConnected ? 'Enlace activo' : 'Listo'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1.5">
                    Conecta varios móviles por WebSocket local en el puerto 3000 mediante código de sala o enlace directo.
                  </p>
                </button>

                <button
                  onClick={() => setTransport('bluetooth')}
                  className={`p-4 rounded-xl border text-left transition-colors cursor-pointer ${
                    transport === 'bluetooth'
                      ? 'bg-[#192338] border-amber-500/70'
                      : 'bg-[#141a26] border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 font-semibold text-sm text-slate-100">
                      <Bluetooth className="w-4 h-4 text-indigo-400" />
                      Bluetooth Cercano (Web GATT)
                    </span>
                    <span className="text-xs text-slate-400">
                      {bluetoothDeviceName ? bluetoothDeviceName : 'Hardware BT'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1.5">
                    Empareja dispositivos Android/Chrome cercanos por Bluetooth y sincroniza la sala e intercambios.
                  </p>
                </button>
              </div>

              {transport === 'bluetooth' && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-[#151c2c] border border-indigo-500/30">
                  <div className="text-xs text-slate-300">
                    {bluetoothDeviceName
                      ? `Dispositivo vinculado: ${bluetoothDeviceName}. Ya puedes crear o unirte a la sala.`
                      : 'Escanea dispositivos Bluetooth cercanos con Web Bluetooth API.'}
                  </div>
                  <button
                    onClick={onPairBluetooth}
                    className="min-h-[44px] px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Buscar Dispositivo Bluetooth
                  </button>
                </div>
              )}

              {/* Create or Join Room */}
              {!roomState ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-[#141a26] border border-slate-800 space-y-3">
                    <h3 className="font-semibold text-sm text-amber-300">
                      Crear Invitación (Patrocinador)
                    </h3>
                    <label className="block text-xs text-slate-400">
                      Evento o Modo de Sala
                      <select
                        value={eventType}
                        onChange={(e) => setEventType(e.target.value as EventType)}
                        className="mt-1.5 w-full min-h-[44px] rounded-lg bg-[#0d111a] border border-slate-700 px-3 text-sm text-slate-100"
                      >
                        {Object.entries(EVENT_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      onClick={() => onCreateRoom(eventType, transport)}
                      className="w-full min-h-[44px] rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold text-sm cursor-pointer"
                    >
                      Crear Sala {transport === 'wifi' ? 'Wi-Fi' : 'Bluetooth'}
                    </button>
                  </div>

                  <div className="p-4 rounded-xl bg-[#141a26] border border-slate-800 space-y-3">
                    <h3 className="font-semibold text-sm text-sky-300">
                      Unirse como Invitado
                    </h3>
                    <label className="block text-xs text-slate-400">
                      Código de Sala (ej. MU-7X4K)
                      <input
                        type="text"
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                        placeholder="MU-XXXX"
                        className="mt-1.5 w-full min-h-[44px] rounded-lg bg-[#0d111a] border border-slate-700 px-3 text-sm font-mono-tabular text-slate-100"
                      />
                    </label>
                    <button
                      onClick={() => onJoinRoom(joinCode, transport)}
                      disabled={!joinCode.trim()}
                      className="w-full min-h-[44px] rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white font-semibold text-sm cursor-pointer disabled:cursor-not-allowed"
                    >
                      Conectar a la Sala
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-[#151d2e] border border-amber-500/40 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="text-xs text-slate-400">
                        Sala Activa · {roomState.transport === 'wifi' ? 'Wi-Fi Local' : 'Bluetooth'} · Patrocinador: {roomState.hostName}
                      </div>
                      <div className="font-mono-tabular text-2xl font-bold text-amber-300 mt-0.5">
                        {roomState.code}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={copyInviteLink}
                        className="min-h-[44px] px-3.5 py-2 rounded-lg bg-[#1e293b] hover:bg-slate-700 text-slate-100 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                        {copied ? 'Enlace Copiado' : 'Copiar Enlace de Invitación'}
                      </button>

                      {roomState.hostPeerId === localPeerId && !roomState.activeEvent && (
                        <button
                          onClick={() => onStartEvent(eventType)}
                          className="min-h-[44px] px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Swords className="w-4 h-4" />
                          Lanzar Evento Cooperativo
                        </button>
                      )}

                      <button
                        onClick={onEndRoom}
                        className="min-h-[44px] px-3.5 py-2 rounded-lg bg-rose-800/80 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer"
                      >
                        {roomState.hostPeerId === localPeerId ? 'Finalizar Invitación' : 'Salir de Sala'}
                      </button>
                    </div>
                  </div>

                  {/* Connected Peers */}
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300">
                      Jugadores Vinculados ({roomState.peers.length})
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {roomState.peers.map((p) => (
                        <div
                          key={p.peerId}
                          className="p-3 rounded-lg bg-[#0f141f] border border-slate-800 flex items-center justify-between"
                        >
                          <div>
                            <div className="text-sm font-semibold text-slate-100">
                              {p.name} {p.peerId === localPeerId ? '(Tú)' : ''}
                            </div>
                            <div className="text-xs text-slate-400 font-mono-tabular">
                              {p.role === 'host' ? 'Patrocinador' : 'Invitado'} · {p.classType} Nv.{p.level} · {p.equippedWeapon} +{p.enhanceLevel}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'trade' && (
            <div className="space-y-4">
              {!roomState || remotePeers.length === 0 ? (
                <div className="p-5 rounded-xl bg-[#141a26] border border-slate-800 text-sm text-slate-300">
                  Conecta al menos a otro jugador (en otra pestaña o móvil conectado al mismo Wi-Fi / sala) para transferir armas y sets en tiempo real. Todo lo transferido queda registrado en el SQLite de ambos jugadores.
                </div>
              ) : (
                <>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-[#141a26] border border-slate-800">
                    <div>
                      <div className="text-xs text-slate-400">Destinatario del intercambio</div>
                      <select
                        value={activeTargetPeerId}
                        onChange={(e) => setSelectedPeerId(e.target.value)}
                        className="mt-1 min-h-[44px] rounded-lg bg-[#0d111a] border border-slate-700 px-3 text-sm text-slate-100"
                      >
                        {remotePeers.map((p) => (
                          <option key={p.peerId} value={p.peerId}>
                            {p.name} ({p.role === 'host' ? 'Patrocinador' : 'Invitado'} · {p.classType})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="text-xs text-emerald-300">
                      Persistencia automática SQLite activa · Propietario original preservado
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-[#141a26] border border-slate-800"
                      >
                        <div>
                          <div className="text-sm font-semibold text-slate-100">
                            {item.name} +{item.enhanceLevel}
                          </div>
                          <div className="text-xs text-slate-400 font-mono-tabular">
                            Set {item.setName} · {item.rarity} · Origen: {item.originalOwner}
                            {item.isEquipped ? ' · Equipado actualmente' : ''}
                          </div>
                        </div>
                        <button
                          onClick={() => onSendItemToPeer(activeTargetPeerId, item)}
                          disabled={!activeTargetPeerId}
                          className="min-h-[44px] px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-slate-950 font-semibold text-xs whitespace-nowrap cursor-pointer"
                        >
                          Enviar / Compartir en Tiempo Real
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'history' && (
            <div className="space-y-4">
              <div className="text-xs text-slate-300">
                Este libro contable vive dentro de tu base de datos SQLite local (`shared_ledger` y `event_sessions`). Aunque termine la invitación o desconectes el Wi-Fi/Bluetooth, tanto el patrocinador como los invitados conservan sus armas, sets y registro completo.
              </div>

              {ledger.length === 0 ? (
                <div className="p-5 rounded-xl bg-[#141a26] border border-slate-800 text-sm text-slate-400">
                  Aún no hay intercambios ni recompensas compartidas registradas.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {ledger.map((entry) => (
                    <div
                      key={entry.id}
                      className="p-3.5 rounded-xl bg-[#141a26] border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div>
                        <div className="text-sm font-semibold text-slate-100">
                          {entry.itemName}
                        </div>
                        <div className="text-xs text-slate-400 font-mono-tabular">
                          {entry.direction === 'sent'
                            ? 'Enviado a'
                            : entry.direction === 'received'
                              ? 'Recibido de'
                              : 'Recompensa de Evento con'}{' '}
                          {entry.partnerName} · Sala {entry.sessionId} · {entry.transportMode.toUpperCase()}
                        </div>
                      </div>
                      <div className="text-xs text-emerald-300 font-mono-tabular">
                        Guardado en SQLite · {new Date(entry.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {eventHistory.length > 0 && (
                <div className="pt-3 border-t border-slate-800 space-y-2">
                  <h4 className="text-xs font-semibold text-amber-300">
                    Sesiones de Eventos Registradas ({eventHistory.length})
                  </h4>
                  {eventHistory.map((ev) => (
                    <div key={ev.id} className="p-3 rounded-lg bg-[#0e131d] border border-slate-800 text-xs text-slate-300 font-mono-tabular">
                      Sala {ev.sessionCode} · {ev.eventType} · Patrocinador: {ev.hostName} · {ev.lootSummary || 'Sesión activa'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
