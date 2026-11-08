// ============================================================
// FART MAN — Multiplayer Networking (Hybrid: MQTT lobby + WebRTC gameplay)
//
// LOBBY:  MQTT WebSocket — works through all firewalls, used for
//         room creation, join requests, and lobby updates.
//
// GAME:   WebRTC DataChannel (PeerJS) — direct peer-to-peer,
//         sub-10ms on same WiFi, used for all real-time input
//         and state broadcasts during gameplay.
//
// Flow:
//   1. Host creates MQTT room, clients join via MQTT.
//   2. After all players join, host broadcasts PeerJS IDs.
//   3. Clients open WebRTC DataChannels to host.
//   4. All gameplay (input/state) flows over DataChannels.
//   5. MQTT stays open only for fallback / match-over signals.
// ============================================================

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
  | { t: 'rtcOffer'; hostPeerId: string }           // host broadcasts its PeerJS ID
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
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `FM${code}`;
}

function genSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── MQTT CDN loader ──

let mqttLib: any = null;

async function loadMqtt(): Promise<any> {
  if (mqttLib) return mqttLib;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/mqtt@4.3.7/dist/mqtt.min.js';
    script.async = true;
    script.onload = () => {
      mqttLib = (window as any).mqtt;
      if (mqttLib) resolve(mqttLib);
      else reject(new Error('MQTT CDN load failed'));
    };
    script.onerror = () => {
      const alt = document.createElement('script');
      alt.src = 'https://cdn.jsdelivr.net/npm/mqtt@4.3.7/dist/mqtt.min.js';
      alt.async = true;
      alt.onload = () => {
        mqttLib = (window as any).mqtt;
        if (mqttLib) resolve(mqttLib);
        else reject(new Error('MQTT CDN failed on both sources'));
      };
      alt.onerror = () => reject(new Error('Could not load networking library'));
      document.head.appendChild(alt);
    };
    document.head.appendChild(script);
  });
}

// ── PeerJS loader ──

let peerLib: any = null;

async function loadPeerJS(): Promise<any> {
  if (peerLib) return peerLib;
  // Try npm bundle first (works if bundler resolved it), fallback to CDN
  try {
    const mod = await import('peerjs');
    peerLib = mod.default ?? mod;
    if (peerLib) return peerLib;
  } catch {}
  return new Promise((resolve, reject) => {
    if ((window as any).Peer) { peerLib = (window as any).Peer; resolve(peerLib); return; }
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';
    s.async = true;
    s.onload = () => { peerLib = (window as any).Peer; peerLib ? resolve(peerLib) : reject(new Error('PeerJS CDN failed')); };
    s.onerror = () => reject(new Error('PeerJS CDN failed'));
    document.head.appendChild(s);
  });
}

// ── Brokers ──

const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    // Open TURN relay for strict NATs
    { urls: 'turn:openrelay.metered.ca:80',    username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443',   username: 'openrelayproject', credential: 'openrelayproject' },
  ],
};

// ── Main class ──

export class PeerConnection {
  // MQTT
  private mqtt:   any = null;
  private connected = false;
  private brokerIndex = 0;

  // WebRTC (PeerJS) — used for real-time gameplay data
  private peer:      any = null;          // local PeerJS peer
  private rtcConns:  Map<number, any> = new Map(); // slot → DataConnection (host side)
  private hostConn:  any = null;           // client's connection to host
  private rtcReady = false;                // true when at least one RTC channel is open

  // Shared
  private role:    Role   = 'host';
  private roomId   = '';
  private mySlot   = 0;
  private myName   = 'Player';
  private mySkinId = 'default';
  private myFaceDataUrl: string | null = null;
  private mySessionId = genSessionId();

  private msgHandlers:    Set<MsgHandler>  = new Set();
  private connHandlers:   Set<ConnHandler> = new Set();
  private disconnHandlers:Set<ConnHandler> = new Set();

  private players:  PlayerNetInfo[] = [];
  private nextSlot  = 1;

  // Topics
  private get topicBase():  string { return `fartman/v1/${this.roomId}/`; }
  private get topicJoin():  string { return `${this.topicBase}join`;  }
  private get topicInput(): string { return `${this.topicBase}input`; }
  private get topicSync():  string { return `${this.topicBase}sync`;  }

  // ── Public API ───────────────────────────────────────────────

  setMyInfo(name: string, skinId: string, faceDataUrl: string | null): void {
    this.myName = name; this.mySkinId = skinId; this.myFaceDataUrl = faceDataUrl;
  }

  // ── Host ────────────────────────────────────────────────────

  async hostRoom(onStatus?: (s: string) => void): Promise<string> {
    this.role   = 'host';
    this.roomId = generateRoomCode();

    await this._connectMQTT(onStatus);
    onStatus?.('Setting up room…');

    await this._subscribe(this.topicJoin);
    await this._subscribe(this.topicInput);  // fallback input channel

    onStatus?.(`Room ready! Code: ${this.roomId}`);

    // Register self as slot 0
    this.mySlot = 0;
    this.players = [{ id: 0, peerId: this.mySessionId, name: this.myName, skinId: this.mySkinId, faceDataUrl: this.myFaceDataUrl, isHost: true }];

    // Handle MQTT messages from clients
    this.mqtt.on('message', (topic: string, payload: any) => {
      try {
        const msg = JSON.parse(this._decode(payload)) as NetMessage;

        if (topic === this.topicJoin && msg.t === 'join') {
          console.log('[Net] Host received join from', msg.name);
          if (this.players.length >= 5) {
            this._mqttPublish(this.topicSync, { t: 'joinAck', yourSlot: -1, players: [], sessionId: msg.sessionId });
            return;
          }
          const slot = this.nextSlot++;
          this.players.push({ id: slot, peerId: msg.peerId, name: msg.name, skinId: msg.skinId, faceDataUrl: msg.faceDataUrl, isHost: false });
          this._mqttPublish(this.topicSync, { t: 'joinAck', yourSlot: slot, players: [...this.players], sessionId: msg.sessionId });
          this._mqttPublish(this.topicSync, { t: 'lobbyUpdate', players: [...this.players] });
          this._dispatch({ t: 'lobbyUpdate', players: [...this.players] });
          this.connHandlers.forEach(h => h());

        } else if (topic === this.topicInput && msg.t === 'input') {
          // Fallback MQTT input (only used if RTC not established yet)
          const slot = (msg as any).slot;
          if (!this.rtcReady && typeof slot === 'number') {
            this._dispatch(msg, slot);
          }
        }
      } catch (e) { console.error('[Net] MQTT parse error', e); }
    });

    // Start PeerJS server for RTC connections
    await this._startHostRTC(onStatus);

    return this.roomId;
  }

  // ── Client ──────────────────────────────────────────────────

  async joinRoom(roomId: string, onStatus?: (s: string) => void): Promise<void> {
    this.role   = 'client';
    this.roomId = roomId.toUpperCase();

    await this._connectMQTT(onStatus);
    onStatus?.(`Looking for room ${this.roomId}…`);

    await this._subscribe(this.topicSync);
    onStatus?.('Connected! Sending join request…');

    let resolved = false;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!resolved) { resolved = true; reject(new Error(`Room "${this.roomId}" not found. Make sure host created the room.`)); }
      }, 12000);

      this.mqtt.on('message', (topic: string, payload: any) => {
        if (topic !== this.topicSync) return;
        try {
          const msg = JSON.parse(this._decode(payload)) as NetMessage;
          console.log('[Net] Client received:', msg.t);

          if (msg.t === 'joinAck' && (msg as any).sessionId === this.mySessionId) {
            if ((msg as any).yourSlot < 0) { clearTimeout(timeout); resolved = true; reject(new Error('Room is full!')); return; }
            clearTimeout(timeout); resolved = true;
            this.mySlot = (msg as any).yourSlot;
            this.players = (msg as any).players;
            onStatus?.('Joined! Connecting P2P…');
            this._dispatch(msg, this.mySlot);
            this.connHandlers.forEach(h => h());
            resolve();

          } else if (msg.t === 'lobbyUpdate') {
            this.players = msg.players; this._dispatch(msg);

          } else if (msg.t === 'rtcOffer') {
            // Host broadcast its PeerJS ID — open a DataChannel to it
            onStatus?.('Opening fast P2P channel…');
            this._connectClientRTC(msg.hostPeerId, onStatus);

          } else if (msg.t === 'startMatch' || msg.t === 'eliminated' || msg.t === 'matchOver') {
            this._dispatch(msg);

          } else if (msg.t === 'state') {
            // MQTT state fallback (used only before RTC is ready)
            if (!this.rtcReady) this._dispatch(msg);
          }
        } catch (e) { console.error('[Net] MQTT parse error', e); }
      });

      this.mqtt.publish(this.topicJoin, JSON.stringify({
        t: 'join', peerId: this.mySessionId,
        name: this.myName, skinId: this.mySkinId,
        faceDataUrl: this.myFaceDataUrl, sessionId: this.mySessionId,
      }), { qos: 1 });
    });
  }

  // ── RTC: Host starts PeerJS peer and broadcasts its ID ──────

  private async _startHostRTC(onStatus?: (s: string) => void): Promise<void> {
    try {
      const PeerJS = await loadPeerJS();
      this.peer = new PeerJS({ config: ICE_SERVERS, debug: 0 });

      this.peer.on('open', (id: string) => {
        console.log('[RTC] Host peer open:', id);
        // Broadcast host's PeerJS ID so clients can connect
        this._mqttPublish(this.topicSync, { t: 'rtcOffer', hostPeerId: id } as any);
      });

      this.peer.on('connection', (conn: any) => {
        conn.on('open', () => {
          console.log('[RTC] Client connected to host via DataChannel');
          const slot = this._findSlotBySessionId(conn.metadata?.sessionId);
          if (slot >= 0) {
            this.rtcConns.set(slot, conn);
            this.rtcReady = true;
          }
        });
        conn.on('data', (data: any) => {
          try {
            const msg = typeof data === 'string' ? JSON.parse(data) : data;
            const slot = this._findSlotBySessionId(conn.metadata?.sessionId);
            if (msg.t === 'input' && slot >= 0) {
              this._dispatch(msg, slot);
            }
          } catch {}
        });
        conn.on('close', () => {
          const slot = this._findSlotBySessionId(conn.metadata?.sessionId);
          if (slot >= 0) { this.rtcConns.delete(slot); }
          this.disconnHandlers.forEach(h => h());
        });
      });

      this.peer.on('error', (err: any) => {
        console.warn('[RTC] Host peer error (falling back to MQTT):', err);
        // Non-fatal — MQTT is the fallback
      });
    } catch (e) {
      console.warn('[RTC] PeerJS not available, using MQTT only:', e);
    }
  }

  // ── RTC: Client connects to host DataChannel ─────────────────

  private async _connectClientRTC(hostPeerId: string, onStatus?: (s: string) => void): Promise<void> {
    try {
      const PeerJS = await loadPeerJS();
      this.peer = new PeerJS({ config: ICE_SERVERS, debug: 0 });

      this.peer.on('open', () => {
        const conn = this.peer.connect(hostPeerId, {
          reliable: false,   // unreliable = lower latency (UDP-like)
          metadata: { sessionId: this.mySessionId },
        });

        conn.on('open', () => {
          console.log('[RTC] Client DataChannel open to host');
          this.hostConn = conn;
          this.rtcReady = true;
          onStatus?.('P2P connected! 🚀');
        });

        conn.on('data', (data: any) => {
          try {
            const msg = typeof data === 'string' ? JSON.parse(data) : data;
            // State arrives over RTC — fast path
            this._dispatch(msg);
          } catch {}
        });

        conn.on('close', () => {
          this.rtcReady = false;
          this.hostConn = null;
          this.disconnHandlers.forEach(h => h());
        });

        conn.on('error', (err: any) => {
          console.warn('[RTC] DataChannel error (MQTT fallback active):', err);
          this.rtcReady = false;
        });
      });

      this.peer.on('error', (err: any) => {
        console.warn('[RTC] Client peer error:', err);
      });
    } catch (e) {
      console.warn('[RTC] PeerJS unavailable:', e);
    }
  }

  private _findSlotBySessionId(sessionId: string): number {
    const p = this.players.find(pl => pl.peerId === sessionId);
    return p ? p.id : -1;
  }

  // ── Lobby ────────────────────────────────────────────────────

  startMatch(arenaW: number, arenaH: number): void {
    // Broadcast via MQTT (reliable, one-time)
    this._mqttPublish(this.topicSync, { t: 'startMatch', arenaW, arenaH });
    this._dispatch({ t: 'startMatch', arenaW, arenaH });
  }

  // ── Game state broadcast ─────────────────────────────────────

  broadcastState(msg: NetMessage): void {
    if (this.rtcReady && this.rtcConns.size > 0) {
      // Fast path: send over RTC DataChannels (sub-10ms)
      const payload = JSON.stringify(msg);
      this.rtcConns.forEach(conn => {
        try { if (conn.open) conn.send(payload); } catch {}
      });
    } else {
      // Fallback: MQTT (higher latency but works everywhere)
      if (this.mqtt?.connected) {
        try { this.mqtt.publish(this.topicSync, JSON.stringify(msg)); } catch {}
      }
    }
  }

  broadcastEliminated(slot: number): void {
    const msg = { t: 'eliminated', slot };
    this._mqttPublish(this.topicSync, msg as any);
    // Also send over RTC so it arrives fast
    if (this.rtcReady) {
      const p = JSON.stringify(msg);
      this.rtcConns.forEach(c => { try { if (c.open) c.send(p); } catch {} });
    }
  }

  broadcastMatchOver(winnerSlot: number, winnerName: string): void {
    const msg = { t: 'matchOver', winnerSlot, winnerName } as NetMessage;
    this._mqttPublish(this.topicSync, msg);
    this._dispatch(msg);
  }

  // ── Client input ─────────────────────────────────────────────

  sendInput(moveX: number, moveY: number, facing: number, attack: boolean, special: boolean): void {
    if (this.role !== 'client') return;
    const msg = { t: 'input', moveX, moveY, facing, attack, special, slot: this.mySlot };
    const payload = JSON.stringify(msg);

    if (this.rtcReady && this.hostConn?.open) {
      // Fast path: DataChannel (UDP-like, ~1-5ms on same WiFi)
      try { this.hostConn.send(payload); } catch {}
    } else if (this.mqtt?.connected) {
      // MQTT fallback
      try { this.mqtt.publish(this.topicInput, payload); } catch {}
    }
  }

  // ── MQTT internals ───────────────────────────────────────────

  private async _connectMQTT(onStatus?: (s: string) => void): Promise<void> {
    onStatus?.('Loading networking library…');
    const mqtt = await loadMqtt();
    const MqttClient = mqtt.connect ?? mqtt;
    onStatus?.('Connecting to relay…');

    for (let i = 0; i < BROKERS.length; i++) {
      const url = BROKERS[(this.brokerIndex + i) % BROKERS.length];
      try {
        await this._tryBroker(MqttClient, url, onStatus);
        this.brokerIndex = (this.brokerIndex + i) % BROKERS.length;
        return;
      } catch (err) {
        console.warn('[MQTT] Broker failed:', url, err);
        if (i < BROKERS.length - 1) onStatus?.('Trying another relay…');
      }
    }
    throw new Error('Could not connect to any relay server. Check your internet.');
  }

  private _tryBroker(MqttClient: any, url: string, onStatus?: (s: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const client = MqttClient(url, {
        clientId: `fm_${this.role}_${Math.random().toString(36).slice(2, 12)}`,
        clean: true, connectTimeout: 6000, keepalive: 30, reconnectPeriod: 0,
      });
      const t = setTimeout(() => { if (!settled) { settled = true; try { client.end(); } catch {} reject(new Error('Timeout')); } }, 8000);
      client.on('connect', () => {
        if (settled) return; settled = true; clearTimeout(t);
        this.connected = true; this.mqtt = client;
        client.options.reconnectPeriod = 3000;
        onStatus?.('Connected to relay!'); resolve();
      });
      client.on('error', (err: any) => { if (!settled) { settled = true; clearTimeout(t); try { client.end(); } catch {} reject(err); } });
      client.on('close', () => { if (this.connected && this.mqtt === client) this.disconnHandlers.forEach(h => h()); });
    });
  }

  private _subscribe(topic: string, qos = 1): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.mqtt) { reject(new Error('Not connected')); return; }
      const t = setTimeout(() => reject(new Error('Subscribe timeout')), 5000);
      this.mqtt.subscribe(topic, { qos }, (err: any) => {
        clearTimeout(t);
        if (err) reject(err); else { console.log('[MQTT] Subscribed:', topic); resolve(); }
      });
    });
  }

  private _mqttPublish(topic: string, msg: any, qos = 1): void {
    if (!this.mqtt?.connected) return;
    try { this.mqtt.publish(topic, JSON.stringify(msg), { qos }); } catch {}
  }

  private _decode(payload: any): string {
    if (typeof payload === 'string') return payload;
    if (payload instanceof Uint8Array || ArrayBuffer.isView(payload)) return new TextDecoder().decode(payload);
    try { return String.fromCharCode.apply(null, payload); } catch { return ''; }
  }

  // ── Message dispatch ─────────────────────────────────────────

  onMessage(handler: MsgHandler):    () => void { this.msgHandlers.add(handler);    return () => this.msgHandlers.delete(handler); }
  onConnect(handler: ConnHandler):   () => void { this.connHandlers.add(handler);   return () => this.connHandlers.delete(handler); }
  onDisconnect(handler: ConnHandler):() => void { this.disconnHandlers.add(handler);return () => this.disconnHandlers.delete(handler); }

  private _dispatch(msg: NetMessage, fromSlot?: number): void {
    this.msgHandlers.forEach(h => h(msg, fromSlot));
  }

  // ── Getters ──────────────────────────────────────────────────

  get isHost():     boolean        { return this.role === 'host'; }
  get slot():       number         { return this.mySlot; }
  get playerList(): PlayerNetInfo[] { return this.players; }
  get playerCount():number         { return this.players.length; }
  get roomCode():   string         { return this.roomId; }
  get isRtcReady(): boolean        { return this.rtcReady; }

  setSlot(slot: number): void { this.mySlot = slot; }

  // ── Cleanup ──────────────────────────────────────────────────

  destroy(): void {
    try { this.mqtt?.end(); }    catch {}
    try { this.peer?.destroy(); } catch {}
    this.rtcConns.forEach(c => { try { c.close(); } catch {} });
    this.rtcConns.clear();
    try { this.hostConn?.close(); } catch {}
    this.mqtt = null; this.peer = null; this.hostConn = null;
    this.connected = false; this.rtcReady = false;
    this.msgHandlers.clear(); this.connHandlers.clear(); this.disconnHandlers.clear();
  }
}
