import type {
  AsyncDuelChallenge,
  AsyncDuelRecord,
  EventType,
  MuItem,
  RoomPeer,
  RoomState,
  TransportMode,
} from '../types/game';

export interface SyncCallbacks {
  onRoomState: (room: RoomState) => void;
  onPeerMoved: (peer: RoomPeer) => void;
  onBossHp: (bossHp: number, bossMaxHp: number, attackerName: string, damage: number) => void;
  onEventCompleted: (
    room: RoomState,
    reward: { itemName: string; zenBonus: number; blessBonus: number; soulBonus: number; eventType: EventType; wave: number },
  ) => void;
  onTradeReceived: (payload: {
    tradeId: string;
    fromPeerName: string;
    fromRole: 'host' | 'guest';
    transport: TransportMode;
    sessionCode: string;
    item: MuItem;
    timestamp: string;
  }) => void;
  onTradeConfirmed: (payload: {
    tradeId: string;
    toPeerName: string;
    toRole: 'host' | 'guest';
    transport: TransportMode;
    sessionCode: string;
    item: MuItem;
    timestamp: string;
  }) => void;
  onDuelChallenge?: (payload: { fromPeerName: string; challenge: AsyncDuelChallenge }) => void;
  onDuelCompleted?: (payload: { record: AsyncDuelRecord }) => void;
  onRoomEnded: (message: string) => void;
  onError: (message: string) => void;
  onConnectionChange: (connected: boolean) => void;
}

export class LocalSyncManager {
  private ws: WebSocket | null = null;
  private callbacks: SyncCallbacks;
  public peerId: string;
  public bluetoothDeviceName: string | null = null;

  constructor(callbacks: SyncCallbacks) {
    this.callbacks = callbacks;
    this.peerId = `peer-${Math.random().toString(36).slice(2, 9)}`;
  }

  connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;
      const socket = new WebSocket(url);

      socket.onopen = () => {
        this.ws = socket;
        this.callbacks.onConnectionChange(true);
        resolve();
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          switch (msg.type) {
            case 'room:state':
              this.callbacks.onRoomState(msg.room);
              break;
            case 'peer:moved':
              this.callbacks.onPeerMoved(msg.peer);
              break;
            case 'event:boss_hp':
              this.callbacks.onBossHp(msg.bossHp, msg.bossMaxHp, msg.attackerName, msg.damage);
              break;
            case 'event:completed':
              this.callbacks.onEventCompleted(msg.room, msg.reward);
              break;
            case 'trade:received':
              this.callbacks.onTradeReceived(msg);
              break;
            case 'trade:confirmed':
              this.callbacks.onTradeConfirmed(msg);
              break;
            case 'duel:challenge':
              this.callbacks.onDuelChallenge?.(msg);
              break;
            case 'duel:completed':
              this.callbacks.onDuelCompleted?.(msg);
              break;
            case 'room:ended':
              this.callbacks.onRoomEnded(msg.message);
              break;
            case 'room:error':
              this.callbacks.onError(msg.message);
              break;
          }
        } catch (err) {
          console.error('Error parseando mensaje WS:', err);
        }
      };

      socket.onclose = () => {
        this.callbacks.onConnectionChange(false);
        this.ws = null;
      };

      socket.onerror = () => {
        this.callbacks.onError('No se pudo conectar al enlace local Wi-Fi (WebSocket).');
        reject(new Error('WebSocket error'));
      };
    });
  }

  async pairBluetoothHardware(): Promise<{ supported: boolean; deviceName?: string; message: string }> {
    const nav = navigator as Navigator & {
      bluetooth?: {
        requestDevice: (opts: { acceptAllDevices?: boolean; optionalServices?: string[] }) => Promise<{
          id: string;
          name?: string;
        }>;
      };
    };

    if (!nav.bluetooth) {
      return {
        supported: false,
        message:
          'Este navegador/webview no expone Web Bluetooth directamente. Usa Chrome en Android o empareja mediante el código de sala Bluetooth/Wi-Fi.',
      };
    }

    try {
      const device = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['battery_service', 'device_information'],
      });
      this.bluetoothDeviceName = device.name || `BT-${device.id.slice(0, 6)}`;
      return {
        supported: true,
        deviceName: this.bluetoothDeviceName,
        message: `Dispositivo Bluetooth vinculado: ${this.bluetoothDeviceName}`,
      };
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Emparejamiento cancelado';
      return {
        supported: true,
        message: `Bluetooth: ${text}`,
      };
    }
  }

  async createRoom(peer: RoomPeer, eventType: EventType, transport: TransportMode, preferredCode?: string) {
    await this.connect();
    this.send({ type: 'room:create', peer, eventType, transport, preferredCode });
  }

  async joinRoom(code: string, peer: RoomPeer, transport: TransportMode) {
    await this.connect();
    this.send({ type: 'room:join', code, peer, transport });
  }

  sendPeerUpdate(patch: Partial<RoomPeer>) {
    this.send({ type: 'peer:update', patch });
  }

  startEvent(eventType: EventType) {
    this.send({ type: 'event:start', eventType });
  }

  damageBoss(damage: number, attackerName: string) {
    this.send({ type: 'event:damage_boss', damage, attackerName });
  }

  sendTradeItem(targetPeerId: string, item: MuItem) {
    this.send({ type: 'trade:send_item', targetPeerId, item });
  }

  sendDuelChallenge(challenge: AsyncDuelChallenge) {
    this.send({ type: 'duel:challenge', challenge });
  }

  sendDuelCompleted(record: AsyncDuelRecord) {
    this.send({ type: 'duel:completed', record });
  }

  endRoom() {
    this.send({ type: 'room:end' });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private send(payload: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}
