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

// ── CDN loader for mqtt.js (avoids bundler issues) ──

let mqttLib: any = null;

async function loadMqtt(): Promise<any> {
  if (mqttLib) return mqttLib;

  // Try loading from CDN — this is the browser build of mqtt.js
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/mqtt@4.3.7/dist/mqtt.min.js';
    script.async = true;
    script.onload = () => {
      // mqtt.js exposes itself as window.mqtt
      mqttLib = (window as any).mqtt;
      if (mqttLib) {
        console.log('[MQTT] Library loaded from CDN');
        resolve(mqttLib);
      } else {
        reject(new Error('MQTT library failed to initialize'));
      }
    };
    script.onerror = () => {
      // Try alternate CDN
      const alt = document.createElement('script');
      alt.src = 'https://cdn.jsdelivr.net/npm/mqtt@4.3.7/dist/mqtt.min.js';
      alt.async = true;
      alt.onload = () => {
        mqttLib = (window as any).mqtt;
        if (mqttLib) {
          console.log('[MQTT] Library loaded from alternate CDN');
          resolve(mqttLib);
        } else {
          reject(new Error('MQTT library failed to load from any CDN'));
        }
      };
      alt.onerror = () => reject(new Error('Could not load networking library. Check your internet.'));
      document.head.appendChild(alt);
    };
    document.head.appendChild(script);
  });
}

// ── Connection class (MQTT-based, same API as PeerConnection) ──

// Try multiple brokers for reliability
const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

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
  private brokerIndex = 0;

  // Topics
  private get topicBase(): string { return `fartman/v1/${this.roomId}/`; }
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
    const mqtt = await loadMqtt();
    const MqttClient = mqtt.connect ?? mqtt;

    onStatus?.('Connecting to relay server…');

    // Try each broker until one works
    for (let i = 0; i < BROKERS.length; i++) {
      const brokerUrl = BROKERS[(this.brokerIndex + i) % BROKERS.length];
      try {
        onStatus?.(`Connecting to relay (${i + 1}/${BROKERS.length})…`);
        await this._tryBroker(MqttClient, brokerUrl, onStatus);
        this.brokerIndex = (this.brokerIndex + i) % BROKERS.length; // remember which worked
        return;
      } catch (err) {
        console.warn(`[MQTT] Broker ${brokerUrl} failed:`, err);
        if (i < BROKERS.length - 1) {
          onStatus?.('Relay busy, trying another server…');
        }
      }
    }
    throw new Error('Could not connect to any relay server. Check your internet connection.');
  }

  private _tryBroker(MqttClient: any, brokerUrl: string, onStatus?: (s: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const client = MqttClient(brokerUrl, {
        clientId: `fm_${this.role}_${Math.random().toString(36).slice(2, 12)}`,
        clean: true,
        connectTimeout: 6000,
        keepalive: 30,
        reconnectPeriod: 0,  // don't auto-reconnect during initial connect
      });

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { client.end(); } catch {}
        reject(new Error(`Timeout connecting to ${brokerUrl}`));
      }, 8000);

      client.on('connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.connected = true;
        this.mqtt = client;
        // Re-enable reconnect for after connection
        client.options.reconnectPeriod = 2000;
        onStatus?.('Connected to relay server!');
        resolve();
      });

      client.on('error', (err: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { client.end(); } catch {}
        reject(err);
      });

      client.on('close', () => {
        if (this.connected && this.mqtt === client) {
          this.disconnHandlers.forEach(h => h());
        }
      });
    });
  }

  // ── Decode MQTT payload (Uint8Array in browser, Buffer in Node) ──

  private _decodePayload(payload: any): string {
    if (typeof payload === 'string') return payload;
    if (payload instanceof Uint8Array || ArrayBuffer.isView(payload)) {
      return new TextDecoder().decode(payload);
    }
    // Fallback for older browsers
    try { return String.fromCharCode.apply(null, payload); } catch { return ''; }
  }

  // ── Subscribe to a topic and wait for confirmation ──

  private _subscribe(topic: string, qos = 1): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.mqtt) { reject(new Error('Not connected')); return; }
      const timeout = setTimeout(() => reject(new Error('Subscription timeout')), 5000);
      this.mqtt.subscribe(topic, { qos }, (err: any) => {
        clearTimeout(timeout);
        if (err) reject(err);
        else {
          console.log(`[MQTT] Subscribed to ${topic}`);
          resolve();
        }
      });
    });
  }

  // ── Host: create room ──

  async hostRoom(onStatus?: (s: string) => void): Promise<string> {
    this.role = 'host';
    this.roomId = generateRoomCode();

    await this._connectToBroker(onStatus);

    onStatus?.('Setting up room…');

    // Wait for subscriptions to be confirmed before accepting joins
    await this._subscribe(this.topicJoin);
    await this._subscribe(this.topicInput);

    onStatus?.(`Room created! Code: ${this.roomId}`);

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

    // Handle incoming messages — set up BEFORE subscriptions confirmed (already done above)
    this.mqtt.on('message', (topic: string, payload: any) => {
      try {
        const msg = JSON.parse(this._decodePayload(payload)) as NetMessage;

        if (topic === this.topicJoin && msg.t === 'join') {
          console.log('[MQTT] Host received join from', msg.name);
          // New player joining
          if (this.players.length >= 5) {
            this.mqtt.publish(this.topicSync, JSON.stringify({
              t: 'joinAck', yourSlot: -1, players: [], sessionId: msg.sessionId,
            }), { qos: 1 });
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
          }), { qos: 1 });

          // Broadcast lobby update to everyone
          this._publish({ t: 'lobbyUpdate', players: this.players });
          this._dispatch({ t: 'lobbyUpdate', players: this.players });
          this.connHandlers.forEach(h => h());

        } else if (topic === this.topicInput && msg.t === 'input') {
          const inputSlot = (msg as any).slot;
          if (typeof inputSlot === 'number') {
            this._dispatch(msg, inputSlot);
          }
        }
      } catch (e) {
        console.error('[MQTT] host parse error:', e);
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

    // Wait for subscription to be confirmed BEFORE sending join request
    await this._subscribe(this.topicSync);
    onStatus?.('Connected! Sending join request…');

    let resolved = false;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        reject(new Error(`Room "${this.roomId}" not found. Make sure the host created the room and the code is correct.`));
      }, 10000);

      // Listen for messages on the sync topic
      this.mqtt.on('message', (topic: string, payload: any) => {
        if (topic !== this.topicSync) return;
        try {
          const msg = JSON.parse(this._decodePayload(payload)) as NetMessage;
          console.log('[MQTT] Client received:', msg.t);

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
          console.error('[MQTT] client parse error:', e);
        }
      });

      // Send join request — now that subscription is confirmed
      console.log('[MQTT] Client sending join request, sessionId:', this.mySessionId);
      this.mqtt.publish(this.topicJoin, JSON.stringify({
        t: 'join',
        peerId: this.mySessionId,
        name: this.myName,
        skinId: this.mySkinId,
        faceDataUrl: this.myFaceDataUrl,
        sessionId: this.mySessionId,
      }), { qos: 1 });
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
