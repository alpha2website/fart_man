// ============================================================
// FART MAN — Multiplayer Networking (MQTT relay)
// Uses a free public MQTT broker over WebSocket for signaling
// and message relay. No WebRTC/ICE/TURN needed — works through
// any firewall that allows WebSocket (basically all of them).
// The broker does not store game data — it only relays messages
// between connected clients in real time.
// ============================================================

// ── Types (same API as before so other files don't change) ──

export type Role = 'host' | 'client';

export interface PlayerNetInfo {
  id: number;
  peerId: string;
  name: string;
  skinId: string;
  faceDataUrl: string | null;
  isHost: boolean;
}

export type NetMessage =
  | { t: 'join'; peerId: string; name: string; skinId: string; faceDataUrl: string | null; sessionId: string }
  | { t: 'joinAck'; yourSlot: number; players: PlayerNetInfo[]; sessionId: string }
  | { t: 'lobbyUpdate'; players: PlayerNetInfo[] }
  | { t: 'startMatch'; arenaW: number; arenaH: number }
  | { t: 'input'; moveX: number; moveY: number; facing: number; attack: boolean; special: boolean }
  | { t: 'state'; players: any[]; projectiles: any[]; timeLeft: number; alive: number }
  | { t: 'eliminated'; slot: number }
  | { t: 'matchOver'; winnerSlot: number; winnerName: string }
  | { t: 'left'; slot: number };

export interface PlayerSnap {
  slot: number; x: number; y: number; vx: number; vy: number;
  hp: number; maxHp: number; alive: boolean; facing: number;
  name: string; skinId: string; faceDataUrl: string | null;
  attackCool: number; specialCool: number; invuln: number;
  hitFlash: number; isHost: boolean;
}

export interface ProjSnap {
  id: number; x: number; y: number; vx: number; vy: number;
  kind: 'blast' | 'bomb' | 'dash'; ownerId: number; life: number; radius: number;
}

type MsgHandler = (msg: NetMessage, fromSlot?: number) => void;
type ConnHandler = () => void;

// ── Helpers ──

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `FM${code}`;
}

function genSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Connection class (MQTT-based, same API as PeerConnection) ──

const BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';
const TOPIC_PREFIX = 'fartman/v1/';

export class PeerConnection {
  private mqtt: any = null;
  private role: Role = 'host';
  private roomId = '';
  private mySlot = 0;
  private myName = 'Player';
  private mySkinId = 'default';
  private myFaceDataUrl: string | null = null;
  private mySessionId = genSessionId();

  private msgHandlers: Set<MsgHandler> = new Set();
  private connHandlers: Set<ConnHandler> = new Set();
  private disconnHandlers: Set<ConnHandler> = new Set();

  private players: PlayerNetInfo[] = [];
  private nextSlot = 1;
  private connected = false;

  // Topics
  private get topicBase(): string { return `${TOPIC_PREFIX}${this.roomId}/`; }
  private get topicJoin(): string   { return `${this.topicBase}join`; }
  private get topicInput(): string  { return `${this.topicBase}input`; }
  private get topicSync(): string   { return `${this.topicBase}sync`; }

  // ── Setup ──

  setMyInfo(name: string, skinId: string, faceDataUrl: string | null): void {
    this.myName = name;
    this.mySkinId = skinId;
    this.myFaceDataUrl = faceDataUrl;
  }

  // ── Connect to MQTT broker (shared by host and client) ──

  private async _connectToBroker(onStatus?: (s: string) => void): Promise<void> {
    onStatus?.('Loading networking library…');
    const mqtt = await import('mqtt');
    const MqttClient = mqtt.default ?? mqtt;

    onStatus?.('Connecting to relay server…');
    return new Promise((resolve, reject) => {
      this.mqtt = MqttClient.connect(BROKER_URL, {
        clientId: `fartman_${this.role}_${Math.random().toString(36).slice(2, 10)}`,
        clean: true,
        connectTimeout: 8000,
        keepalive: 30,
        reconnectPeriod: 2000,
      });

      const timeout = setTimeout(() => {
        reject(new Error('Could not reach relay server. Check your internet.'));
      }, 12000);

      this.mqtt.on('connect', () => {
        clearTimeout(timeout);
        this.connected = true;
        onStatus?.('Connected to relay server!');
        resolve();
      });

      this.mqtt.on('error', (err: any) => {
        clearTimeout(timeout);
        console.error('[MQTT] error:', err);
        if (!this.connected) {
          reject(new Error('Relay server error. Try again.'));
        }
      });

      this.mqtt.on('close', () => {
        if (this.connected) {
          this.disconnHandlers.forEach(h => h());
        }
      });
    });
  }

  // ── Host: create room ──

  async hostRoom(onStatus?: (s: string) => void): Promise<string> {
    this.role = 'host';
    this.roomId = generateRoomCode();

    await this._connectToBroker(onStatus);

    onStatus?.(`Room created! Code: ${this.roomId}`);

    // Host subscribes to join and input topics
    this.mqtt.subscribe(this.topicJoin);
    this.mqtt.subscribe(this.topicInput);

    // Register self as slot 0
    this.mySlot = 0;
    this.players = [{
      id: 0,
      peerId: this.mySessionId,
      name: this.myName,
      skinId: this.mySkinId,
      faceDataUrl: this.myFaceDataUrl,
      isHost: true,
    }];

    // Handle incoming messages
    this.mqtt.on('message', (topic: string, payload: Buffer) => {
      try {
        const msg = JSON.parse(payload.toString()) as NetMessage;

        if (topic === this.topicJoin && msg.t === 'join') {
          // New player joining
          if (this.players.length >= 5) {
            this.mqtt.publish(this.topicSync, JSON.stringify({
              t: 'joinAck', yourSlot: -1, players: [], sessionId: msg.sessionId,
            }));
            return;
          }
          const slot = this.nextSlot++;
          const pInfo: PlayerNetInfo = {
            id: slot, peerId: msg.peerId, name: msg.name,
            skinId: msg.skinId, faceDataUrl: msg.faceDataUrl, isHost: false,
          };
          this.players.push(pInfo);

          // Send join ack to this specific client (via sessionId)
          this.mqtt.publish(this.topicSync, JSON.stringify({
            t: 'joinAck', yourSlot: slot, players: this.players, sessionId: msg.sessionId,
          }));

          // Broadcast lobby update to everyone
          this._publish({ t: 'lobbyUpdate', players: this.players });
          this._dispatch({ t: 'lobbyUpdate', players: this.players });
          this.connHandlers.forEach(h => h());

        } else if (topic === this.topicInput && msg.t === 'input') {
          // Client input — dispatch with the slot included in the message
          const inputSlot = (msg as any).slot;
          if (typeof inputSlot === 'number') {
            this._dispatch(msg, inputSlot);
          }
        }
      } catch (e) {
        console.error('[MQTT] parse error:', e);
      }
    });

    return this.roomId;
  }

  // ── Client: join room ──

  async joinRoom(roomId: string, onStatus?: (s: string) => void): Promise<void> {
    this.role = 'client';
    this.roomId = roomId.toUpperCase();

    await this._connectToBroker(onStatus);

    onStatus?.(`Looking for room ${this.roomId}…`);

    // Client subscribes to sync topic (host → all)
    this.mqtt.subscribe(this.topicSync);

    let resolved = false;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        reject(new Error(`Room "${this.roomId}" not found. Make sure the host created the room and the code is correct.`));
      }, 8000);

      // Listen for messages
      this.mqtt.on('message', (topic: string, payload: Buffer) => {
        if (topic !== this.topicSync) return;
        try {
          const msg = JSON.parse(payload.toString()) as NetMessage;

          if (msg.t === 'joinAck' && (msg as any).sessionId === this.mySessionId) {
            // This is our join ack
            if ((msg as any).yourSlot < 0) {
              clearTimeout(timeout);
              resolved = true;
              reject(new Error('Room is full (max 5 players)!'));
              return;
            }
            clearTimeout(timeout);
            resolved = true;
            this.mySlot = (msg as any).yourSlot;
            this.players = (msg as any).players;
            onStatus?.('Joined room!');
            // Dispatch to UI
            this._dispatch(msg, this.mySlot);
            this.connHandlers.forEach(h => h());
            resolve();
          } else if (msg.t === 'lobbyUpdate') {
            this.players = msg.players;
            this._dispatch(msg);
          } else if (msg.t === 'startMatch' || msg.t === 'state' || msg.t === 'eliminated' || msg.t === 'matchOver') {
            this._dispatch(msg);
          }
        } catch (e) {
          console.error('[MQTT] parse error:', e);
        }
      });

      // Send join request
      onStatus?.('Sending join request…');
      this.mqtt.publish(this.topicJoin, JSON.stringify({
        t: 'join',
        peerId: this.mySessionId,
        name: this.myName,
        skinId: this.mySkinId,
        faceDataUrl: this.myFaceDataUrl,
        sessionId: this.mySessionId,
      }));
    });
  }

  // ── Host: broadcast to all clients ──

  private _publish(msg: NetMessage): void {
    if (!this.mqtt?.connected) return;
    try {
      this.mqtt.publish(this.topicSync, JSON.stringify(msg));
    } catch { /* ignore */ }
  }

  // ── Host: start match ──

  startMatch(arenaW: number, arenaH: number): void {
    this._publish({ t: 'startMatch', arenaW, arenaH });
    this._dispatch({ t: 'startMatch', arenaW, arenaH });
  }

  // ── Host: broadcast game state ──

  broadcastState(msg: NetMessage): void {
    this._publish(msg);
  }

  broadcastEliminated(slot: number): void {
    this._publish({ t: 'eliminated', slot });
  }

  broadcastMatchOver(winnerSlot: number, winnerName: string): void {
    this._publish({ t: 'matchOver', winnerSlot, winnerName });
    this._dispatch({ t: 'matchOver', winnerSlot, winnerName });
  }

  // ── Client: send input to host ──

  sendInput(moveX: number, moveY: number, facing: number, attack: boolean, special: boolean): void {
    if (this.role !== 'client' || !this.mqtt?.connected) return;
    try {
      this.mqtt.publish(this.topicInput, JSON.stringify({
        t: 'input', moveX, moveY, facing, attack, special, slot: this.mySlot,
      }));
    } catch { /* ignore */ }
  }

  // ── Message dispatch ──

  onMessage(handler: MsgHandler): () => void {
    this.msgHandlers.add(handler);
    return () => this.msgHandlers.delete(handler);
  }

  onConnect(handler: ConnHandler): () => void {
    this.connHandlers.add(handler);
    return () => this.connHandlers.delete(handler);
  }

  onDisconnect(handler: ConnHandler): () => void {
    this.disconnHandlers.add(handler);
    return () => this.disconnHandlers.delete(handler);
  }

  private _dispatch(msg: NetMessage, fromSlot?: number): void {
    this.msgHandlers.forEach(h => h(msg, fromSlot));
  }

  // ── Getters ──

  get isHost(): boolean { return this.role === 'host'; }
  get slot(): number { return this.mySlot; }
  get playerList(): PlayerNetInfo[] { return this.players; }
  get playerCount(): number { return this.players.length; }
  get roomCode(): string { return this.roomId; }

  setSlot(slot: number): void { this.mySlot = slot; }

  // ── Cleanup ──

  destroy(): void {
    try { this.mqtt?.end(); } catch {}
    this.mqtt = null;
    this.connected = false;
    this.msgHandlers.clear();
    this.connHandlers.clear();
    this.disconnHandlers.clear();
  }
}
