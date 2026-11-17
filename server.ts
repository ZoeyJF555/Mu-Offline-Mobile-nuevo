import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import type {
  EventType,
  HeroClass,
  MuItem,
  RoomPeer,
  RoomState,
  SharedLedgerEntry,
  TransportMode,
} from './src/types/game.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000;
const APP_VERSION = '1.4.0';

interface ServerRoom {
  code: string;
  eventType: EventType;
  hostPeerId: string;
  hostName: string;
  transport: TransportMode;
  activeEvent: boolean;
  eventWave: number;
  bossHp: number;
  bossMaxHp: number;
  peers: Map<string, { peer: RoomPeer; ws: WebSocket }>;
  sharedFeed: SharedLedgerEntry[];
  createdAt: number;
}

const rooms = new Map<string, ServerRoom>();

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `MU-${suffix}`;
}

function serializeRoom(room: ServerRoom): RoomState {
  return {
    code: room.code,
    eventType: room.eventType,
    hostPeerId: room.hostPeerId,
    hostName: room.hostName,
    transport: room.transport,
    activeEvent: room.activeEvent,
    eventWave: room.eventWave,
    bossHp: room.bossHp,
    bossMaxHp: room.bossMaxHp,
    peers: Array.from(room.peers.values()).map((entry) => entry.peer),
    sharedFeed: room.sharedFeed.slice(-30),
  };
}

function broadcastRoom(room: ServerRoom, payload: Record<string, unknown>, excludePeerId?: string) {
  const message = JSON.stringify(payload);
  for (const [peerId, entry] of room.peers.entries()) {
    if (excludePeerId && peerId === excludePeerId) continue;
    if (entry.ws.readyState === WebSocket.OPEN) {
      entry.ws.send(message);
    }
  }
}

function createGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY no está configurada en el servidor.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    let currentRoomCode: string | null = null;
    let currentPeerId: string | null = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          [key: string]: unknown;
        };

        if (msg.type === 'room:create') {
          const peer = msg.peer as RoomPeer;
          const eventType = (msg.eventType as EventType) || 'blood_castle';
          const transport = (msg.transport as TransportMode) || 'wifi';
          let code = (msg.preferredCode as string) || generateRoomCode();
          while (rooms.has(code)) {
            code = generateRoomCode();
          }

          const room: ServerRoom = {
            code,
            eventType,
            hostPeerId: peer.peerId,
            hostName: peer.name,
            transport,
            activeEvent: false,
            eventWave: 1,
            bossHp: 1200,
            bossMaxHp: 1200,
            peers: new Map(),
            sharedFeed: [],
            createdAt: Date.now(),
          };
          const hostPeer: RoomPeer = { ...peer, role: 'host', transport };
          room.peers.set(peer.peerId, { peer: hostPeer, ws });
          rooms.set(code, room);

          currentRoomCode = code;
          currentPeerId = peer.peerId;

          ws.send(JSON.stringify({ type: 'room:state', room: serializeRoom(room) }));
          return;
        }

        if (msg.type === 'room:join') {
          const code = String(msg.code || '').trim().toUpperCase();
          const peer = msg.peer as RoomPeer;
          const transport = (msg.transport as TransportMode) || 'wifi';
          const room = rooms.get(code);
          if (!room) {
            ws.send(
              JSON.stringify({
                type: 'room:error',
                message: `No se encontró la sala "${code}". Verifica el código con el patrocinador.`,
              }),
            );
            return;
          }

          const guestPeer: RoomPeer = { ...peer, role: 'guest', transport };
          room.peers.set(peer.peerId, { peer: guestPeer, ws });
          currentRoomCode = code;
          currentPeerId = peer.peerId;

          broadcastRoom(room, { type: 'room:state', room: serializeRoom(room) });
          return;
        }

        if (!currentRoomCode || !currentPeerId) return;
        const room = rooms.get(currentRoomCode);
        if (!room) return;

        if (msg.type === 'peer:update') {
          const entry = room.peers.get(currentPeerId);
          if (!entry) return;
          const patch = msg.patch as Partial<RoomPeer>;
          entry.peer = { ...entry.peer, ...patch };
          broadcastRoom(
            room,
            { type: 'peer:moved', peer: entry.peer },
            currentPeerId,
          );
          return;
        }

        if (msg.type === 'event:start') {
          const eventType = (msg.eventType as EventType) || room.eventType;
          room.eventType = eventType;
          room.activeEvent = true;
          room.eventWave = 1;
          room.bossMaxHp = eventType === 'kundun_boss' ? 2400 : 1400;
          room.bossHp = room.bossMaxHp;
          broadcastRoom(room, { type: 'room:state', room: serializeRoom(room) });
          return;
        }

        if (msg.type === 'event:damage_boss') {
          if (!room.activeEvent) return;
          const dmg = Math.max(10, Math.min(500, Number(msg.damage) || 50));
          room.bossHp = Math.max(0, room.bossHp - dmg);
          if (room.bossHp <= 0) {
            const rewardNames: Record<EventType, string> = {
              blood_castle: 'Espada del Arcángel Bendita',
              chaos_castle: 'Coraza del Caos Antigua',
              kundun_boss: 'Báculo de Kundun Supremo',
              free_trade: 'Alas de Lorencia Doradas',
            };
            const rewardId = `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const rewardItemName = rewardNames[room.eventType];
            const rewardEntry: SharedLedgerEntry = {
              id: `led-${Date.now()}`,
              sessionId: room.code,
              transportMode: room.transport,
              partnerName: room.hostName,
              role: 'guest',
              direction: 'event_reward',
              itemId: rewardId,
              itemName: rewardItemName,
              itemSnapshotJson: JSON.stringify({
                name: rewardItemName,
                enhanceLevel: 7,
                rarity: 'excellent',
              }),
              status: 'committed',
              createdAt: new Date().toISOString(),
            };
            room.sharedFeed.push(rewardEntry);
            room.eventWave += 1;
            room.activeEvent = false;
            broadcastRoom(room, {
              type: 'event:completed',
              room: serializeRoom(room),
              reward: {
                itemName: rewardItemName,
                zenBonus: 45000,
                blessBonus: 2,
                soulBonus: 2,
                eventType: room.eventType,
                wave: room.eventWave - 1,
              },
            });
          } else {
            broadcastRoom(room, {
              type: 'event:boss_hp',
              bossHp: room.bossHp,
              bossMaxHp: room.bossMaxHp,
              attackerName: String(msg.attackerName || 'Aliado'),
              damage: dmg,
            });
          }
          return;
        }

        if (msg.type === 'trade:send_item') {
          const item = msg.item as MuItem;
          const targetPeerId = String(msg.targetPeerId || '');
          const fromPeer = room.peers.get(currentPeerId)?.peer;
          const targetEntry = room.peers.get(targetPeerId);
          if (!fromPeer || !targetEntry || !item) return;

          const tradeId = `trd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const timestamp = new Date().toISOString();
          const snapshotJson = JSON.stringify(item);

          const feedEntry: SharedLedgerEntry = {
            id: tradeId,
            sessionId: room.code,
            transportMode: room.transport,
            partnerName: `${fromPeer.name} → ${targetEntry.peer.name}`,
            role: fromPeer.role,
            direction: 'sent',
            itemId: item.id,
            itemName: `${item.name} +${item.enhanceLevel}`,
            itemSnapshotJson: snapshotJson,
            status: 'committed',
            createdAt: timestamp,
          };
          room.sharedFeed.push(feedEntry);

          if (targetEntry.ws.readyState === WebSocket.OPEN) {
            targetEntry.ws.send(
              JSON.stringify({
                type: 'trade:received',
                tradeId,
                fromPeerName: fromPeer.name,
                fromRole: fromPeer.role,
                transport: room.transport,
                sessionCode: room.code,
                item,
                timestamp,
              }),
            );
          }

          ws.send(
            JSON.stringify({
              type: 'trade:confirmed',
              tradeId,
              toPeerName: targetEntry.peer.name,
              toRole: targetEntry.peer.role,
              transport: room.transport,
              sessionCode: room.code,
              item,
              timestamp,
            }),
          );

          broadcastRoom(room, { type: 'room:state', room: serializeRoom(room) });
          return;
        }

        if (msg.type === 'room:end') {
          if (room.hostPeerId === currentPeerId) {
            broadcastRoom(room, {
              type: 'room:ended',
              code: room.code,
              message:
                'La invitación finalizó. Todos los ítems compartidos y recompensas quedaron guardados en tu base SQLite local.',
            });
            rooms.delete(room.code);
          } else {
            room.peers.delete(currentPeerId);
            broadcastRoom(room, { type: 'room:state', room: serializeRoom(room) });
          }
          currentRoomCode = null;
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    });

    ws.on('close', () => {
      if (!currentRoomCode || !currentPeerId) return;
      const room = rooms.get(currentRoomCode);
      if (!room) return;
      room.peers.delete(currentPeerId);
      if (room.peers.size === 0) {
        rooms.delete(currentRoomCode);
      } else {
        if (room.hostPeerId === currentPeerId) {
          const nextHost = room.peers.values().next().value;
          if (nextHost) {
            nextHost.peer.role = 'host';
            room.hostPeerId = nextHost.peer.peerId;
            room.hostName = nextHost.peer.name;
          }
        }
        broadcastRoom(room, { type: 'room:state', room: serializeRoom(room) });
      }
    });
  });

  // API: OTA / APK Release Manifest
  app.get('/api/ota/manifest', (req, res) => {
    const origin = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    res.json({
      appName: 'MU Lorencia Offline & Sync',
      version: APP_VERSION,
      buildTimestamp: new Date().toISOString(),
      webEntryUrl: origin,
      offlineEngine: 'sql.js (SQLite WASM + IndexedDB)',
      transports: ['wifi-websocket', 'web-bluetooth-gatt'],
      githubWorkflow: '.github/workflows/build-apk.yml',
    });
  });

  // API: List active Wi-Fi rooms on local server
  app.get('/api/rooms', (_req, res) => {
    const active = Array.from(rooms.values()).map((room) => ({
      code: room.code,
      hostName: room.hostName,
      eventType: room.eventType,
      transport: room.transport,
      peerCount: room.peers.size,
      activeEvent: room.activeEvent,
    }));
    res.json({ rooms: active });
  });

  // API: Gemini Multi-Turn Chatbot (Oráculo de Lorencia)
  app.post('/api/gemini/chat', async (req, res) => {
    try {
      const { history = [], message, playerContext } = req.body as {
        history?: Array<{ role: 'user' | 'model'; content: string }>;
        message: string;
        playerContext?: {
          name: string;
          classType: HeroClass;
          level: number;
          zen: number;
          bless: number;
          soul: number;
          equippedItems: string[];
          sharedCount: number;
        };
      };

      if (!message || !message.trim()) {
        res.status(400).json({ error: 'El mensaje no puede estar vacío.' });
        return;
      }

      const ai = createGeminiClient();
      const contextSummary = playerContext
        ? `Héroe actual en SQLite: ${playerContext.name} (Clase: ${playerContext.classType}, Nivel ${playerContext.level}). Zen: ${playerContext.zen}, Bless: ${playerContext.bless}, Soul: ${playerContext.soul}. Equipo: ${playerContext.equippedItems.join(', ') || 'Básico'}. Ítems compartidos en historial: ${playerContext.sharedCount}.`
        : 'Sin contexto de héroe cargado.';

      const systemInstruction =
        'Eres el Oráculo de Lorencia, un maestro herrero y estratega experto de MU Offline. ' +
        'Respondes siempre en español claro, conciso y práctico. Ayudas al jugador con builds (Dark Knight, Dark Wizard, Fairy Elf), ' +
        'estrategias de eventos (Blood Castle, Chaos Castle, Kundun), mejoras con Jewel of Bless/Soul (+0 a +13), ' +
        'y consejos sobre cómo intercambiar armas y sets de forma segura por Wi-Fi/Bluetooth con respaldo SQLite. ' +
        contextSummary;

      const chat = ai.chats.create({
        model: 'gemini-4-hydrogen',
        history: history.slice(-12).map((h) => ({
          role: h.role,
          parts: [{ text: h.content }],
        })),
        config: {
          systemInstruction,
        },
      });

      const response = await chat.sendMessage({ message });
      res.json({ reply: response.text || 'El Oráculo permanece en silencio.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error consultando a Gemini.';
      console.error('Gemini chat error:', err);
      res.status(500).json({ error: message });
    }
  });

  // API: Gemini Build & Inventory Analyzer (Structured JSON)
  app.post('/api/gemini/analyze-build', async (req, res) => {
    try {
      const { character, items, ledgerCount } = req.body as {
        character: Record<string, unknown>;
        items: MuItem[];
        ledgerCount: number;
      };

      const ai = createGeminiClient();
      const equipped = (items || [])
        .filter((i) => i.isEquipped)
        .map((i) => `${i.slot}: ${i.name} +${i.enhanceLevel} (${i.rarity})`)
        .join('; ');

      const prompt = `Analiza este personaje de MU Lorencia Offline guardado en SQLite y devuelve recomendaciones tácticas en español:
Personaje: ${JSON.stringify(character)}
Equipo equipado: ${equipped || 'Ninguno'}
Total ítems en inventario: ${items?.length || 0}
Registros en historial compartido Wi-Fi/Bluetooth: ${ledgerCount || 0}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: prompt,
        config: {
          systemInstruction:
            'Eres un analista táctico de MU Offline. Evalúa el equipo, distribución de stats (STR/AGI/VIT/ENE), prioridad de joyas Bless/Soul y preparación para Blood Castle y Kundun.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              combatRating: {
                type: Type.STRING,
                description: 'Rango de poder corto, ej: Grado A · Veterano de Lorencia',
              },
              upgradePriority: {
                type: Type.STRING,
                description: 'Qué arma o pieza de set subir primero con Bless/Soul',
              },
              statAdvice: {
                type: Type.STRING,
                description: 'Consejo corto para repartir STR, AGI, VIT y ENE',
              },
              eventReadiness: {
                type: Type.STRING,
                description: 'Evaluación para Blood Castle, Chaos Castle o Kundun',
              },
              recommendations: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Lista de 3 acciones concretas',
              },
            },
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json({ analysis: parsed });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error analizando build.';
      console.error('Gemini analyze error:', err);
      res.status(500).json({ error: message });
    }
  });

  // Vite middleware in dev, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`MU Lorencia Offline & Sync server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
