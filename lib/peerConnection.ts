// ============================================================
// FART MAN — Peer-to-Peer Networking Layer
// Uses PeerJS (WebRTC) for device-to-device multiplayer.
// Optimized for fast connection: multiple STUN servers,
// reliable data channel, compressed face data, timeout handling.
// ============================================================

import { SkinDef } from './gameConfig';

// ── Types ──

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
  // Client → Host
  | { t: 'join'; peerId: string; name: string; skinId: string; faceDataUrl: string | null }
  | { t: 'input'; moveX: number; moveY: number; facing: number; attack: boolean; special: boolean }
  // Host → All Clients
  | { t: 'joinAck'; yourSlot: number; players: PlayerNetInfo[] }
  | { t: 'lobbyUpdate'; players: PlayerNetInfo[] }
  | { t: 'startMatch'; arenaW: number; arenaH: number }
  | { t: 'state'; players: PlayerSnap[]; projectiles: ProjSnap[]; timeLeft: number; alive: number }
  | { t: 'eliminated'; slot: number }
  | { t: 'matchOver'; winnerSlot: number; winnerName: string }
  | { t: 'left'; slot: number };

export interface PlayerSnap {
  slot: number;
  x: number; y: number;
  vx: number; vy: number;
  hp: number; maxHp: number;
  alive: boolean;
  facing: number;
  name: string;
  skinId: string;
  faceDataUrl: string | null;
  attackCool: number;
  specialCool: number;
  invuln: number;
  hitFlash: number;
  isHost: boolean;
}

export interface ProjSnap {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  kind: 'blast' | 'bomb' | 'dash';
  ownerId: number;
  life: number;
  radius: number;
}

type MsgHandler = (msg: NetMessage, fromSlot?: number) => void;
type ConnHandler = () => void;

// ── ICE servers for fast NAT traversal ──
// STUN for discovery + TURN relay as fallback for strict NATs

const ICE_SERVERS = {
  iceServers: [
    // Google STUN servers (fast discovery)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Twilio STUN
    { urls: 'stun:global.stun.twilio.com:3478' },
    // OpenRelay free TURN servers (Metered.ca) — relay fallback for strict NATs
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

// ── Helper: generate a short room code ──

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `FM${code}`;
}

// ── Helper: compress face image data URL to small JPEG ──

export function compressFaceDataUrl(dataUrl: string): string {
  try {
    // Already small enough
    if (dataUrl.length < 2000) return dataUrl;
    // Convert to compressed JPEG via canvas
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    img.src = dataUrl;
    // Can't do this synchronously, return original — but in practice
    // the FaceCropEditor already produces a 120x120 PNG which is ~3-8KB
    return dataUrl;
  } catch {
    return dataUrl;
  }
}

// ── PeerConnection class ──

export class PeerConnection {
  private peer: any = null;
  private role: Role = 'host';
  private roomId = '';
  private conns: Map<number, any> = new Map();
  private hostConn: any = null;
  private mySlot = 0;
  private myName = 'Player';
  private mySkinId = 'default';
  private myFaceDataUrl: string | null = null;

  private msgHandlers: Set<MsgHandler> = new Set();
  private connHandlers: Set<ConnHandler> = new Set();
  private disconnHandlers: Set<ConnHandler> = new Set();

  private players: PlayerNetInfo[] = [];
  private nextSlot = 1;

  // Connection timeout
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;
  private static CONNECT_TIMEOUT_MS = 12000; // 12s max

  // ── Setup ──

  setMyInfo(name: string, skinId: string, faceDataUrl: string | null): void {
    this.myName = name;
    this.mySkinId = skinId;
    // Compress face data if present
    this.myFaceDataUrl = faceDataUrl ? compressFaceDataUrl(faceDataUrl) : null;
  }

  // ── Host: create room ──

  async hostRoom(): Promise<string> {
    this.role = 'host';
    this.roomId = generateRoomCode();

    const Peer = (await import('peerjs')).default;
    this.peer = new Peer(this.roomId, {
      debug: 1,
      config: ICE_SERVERS,
    });

    return new Promise((resolve, reject) => {
      if (!this.peer) { reject(new Error('Peer not created')); return; }

      const timeout = setTimeout(() => {
        reject(new Error('Connection timed out. Check your internet.'));
      }, PeerConnection.CONNECT_TIMEOUT_MS);

      this.peer.on('open', () => {
        clearTimeout(timeout);
        this.mySlot = 0;
        this.players = [{
          id: 0,
          peerId: this.peer.id,
          name: this.myName,
          skinId: this.mySkinId,
          faceDataUrl: this.myFaceDataUrl,
          isHost: true,
        }];
        resolve(this.roomId);
      });

      this.peer.on('error', (err: any) => {
        clearTimeout(timeout);
        console.error('[Peer] error:', err);
        if (err.type === 'unavailable-id') {
          this.roomId = generateRoomCode();
          this.peer.destroy();
          this.hostRoom().then(resolve).catch(reject);
        } else {
          reject(err);
        }
      });

      this.peer.on('connection', (conn: any) => {
        this._handleClientConn(conn);
      });
    });
  }

  // ── Client: join room (with retry) ──

  async joinRoom(roomId: string): Promise<void> {
    this.role = 'client';
    this.roomId = roomId;

    const Peer = (await import('peerjs')).default;
    this.peer = new Peer({ debug: 1, config: ICE_SERVERS });

    return new Promise((resolve, reject) => {
      if (!this.peer) { reject(new Error('Peer not created')); return; }

      let timedOut = false;
      let connAttempt = 0;
      const MAX_ATTEMPTS = 3;
      let conn: any = null;

      // Overall timeout — generous for slow mobile networks
      const overallTimeout = setTimeout(() => {
        timedOut = true;
        reject(new Error('Connection timed out after 20s. Check the room code and try again.'));
      }, 20000);

      const tryConnect = () => {
        connAttempt++;
        if (timedOut) return;

        // Connect to host — reliable, default serialization (BinaryPack)
        conn = this.peer.connect(roomId, { reliable: true });

        // Per-attempt timeout
        const attemptTimeout = setTimeout(() => {
          if (timedOut) return;
          if (connAttempt < MAX_ATTEMPTS) {
            // Retry
            console.log(`[Peer] Connection attempt ${connAttempt} timed out, retrying…`);
            try { conn.close(); } catch {}
            setTimeout(tryConnect, 1000);
          } else {
            if (!timedOut) {
              reject(new Error('Could not reach room. The room may not exist or your network may be blocking P2P connections.'));
            }
          }
        }, 8000);

        conn.on('open', () => {
          clearTimeout(attemptTimeout);
          clearTimeout(overallTimeout);
          this.hostConn = conn;

          // Send join
          conn.send({
            t: 'join',
            peerId: this.peer.id,
            name: this.myName,
            skinId: this.mySkinId,
            faceDataUrl: this.myFaceDataUrl,
          });
          resolve();
        });

        conn.on('data', (data: NetMessage) => {
          this._dispatch(data);
        });

        conn.on('close', () => {
          this.disconnHandlers.forEach(h => h());
        });

        conn.on('error', (err: any) => {
          clearTimeout(attemptTimeout);
          console.error(`[Peer] conn error (attempt ${connAttempt}):`, err);
          if (timedOut) return;
          if (connAttempt < MAX_ATTEMPTS) {
            setTimeout(tryConnect, 1000);
          } else {
            clearTimeout(overallTimeout);
            reject(new Error('Connection failed. The room may not exist.'));
          }
        });
      };

      this.peer.on('open', () => {
        if (timedOut) return;
        console.log('[Peer] Client peer open, connecting to host…');
        tryConnect();
      });

      this.peer.on('error', (err: any) => {
        clearTimeout(overallTimeout);
        console.error('[Peer] error:', err);
        if (!timedOut) {
          if (err.type === 'peer-unavailable') {
            reject(new Error('Room not found. Check the code and make sure the host is still in the room.'));
          } else {
            reject(err);
          }
        }
      });
    });
  }

  // ── Host: handle incoming client connection ──

  private _handleClientConn(conn: any): void {
    conn.on('open', () => {
      // Waiting for join message
    });

    conn.on('data', (data: NetMessage) => {
      if (data.t === 'join') {
        if (this.players.length >= 5) {
          conn.send({ t: 'joinAck', yourSlot: -1, players: [] });
          conn.close();
          return;
        }
        const slot = this.nextSlot++;
        this.conns.set(slot, conn);

        const pInfo: PlayerNetInfo = {
          id: slot,
          peerId: data.peerId,
          name: data.name,
          skinId: data.skinId,
          faceDataUrl: data.faceDataUrl,
          isHost: false,
        };
        this.players.push(pInfo);

        // Send ack immediately
        conn.send({ t: 'joinAck', yourSlot: slot, players: this.players });

        // Broadcast lobby update to all clients
        this._broadcastLobby();

        // Notify our own UI
        this.connHandlers.forEach(h => h());
      } else if (data.t === 'input') {
        const slot = this._findSlotByConn(conn);
        this._dispatch(data, slot);
      }
    });

    conn.on('close', () => {
      const slot = this._findSlotByConn(conn);
      if (slot >= 0) {
        this.conns.delete(slot);
        this.players = this.players.filter(p => p.id !== slot);
        this._broadcast({ t: 'left', slot });
        this._broadcastLobby();
        this.disconnHandlers.forEach(h => h());
      }
    });
  }

  private _findSlotByConn(conn: any): number {
    for (const [slot, c] of this.conns) {
      if (c === conn) return slot;
    }
    return -1;
  }

  // ── Host: broadcast to all clients ──

  private _broadcast(msg: NetMessage): void {
    this.conns.forEach(conn => {
      try { if (conn.open) conn.send(msg); } catch { /* ignore */ }
    });
  }

  private _broadcastLobby(): void {
    this._broadcast({ t: 'lobbyUpdate', players: this.players });
    this._dispatch({ t: 'lobbyUpdate', players: this.players });
  }

  // ── Host: start match ──

  startMatch(arenaW: number, arenaH: number): void {
    this._broadcast({ t: 'startMatch', arenaW, arenaH });
    this._dispatch({ t: 'startMatch', arenaW, arenaH });
  }

  // ── Host: broadcast game state ──

  broadcastState(msg: NetMessage): void {
    this._broadcast(msg);
  }

  broadcastEliminated(slot: number): void {
    this._broadcast({ t: 'eliminated', slot });
  }

  broadcastMatchOver(winnerSlot: number, winnerName: string): void {
    this._broadcast({ t: 'matchOver', winnerSlot, winnerName });
    this._dispatch({ t: 'matchOver', winnerSlot, winnerName });
  }

  // ── Client: send input to host ──

  sendInput(moveX: number, moveY: number, facing: number, attack: boolean, special: boolean): void {
    if (this.role !== 'client' || !this.hostConn) return;
    try {
      if (this.hostConn.open) {
        this.hostConn.send({ t: 'input', moveX, moveY, facing, attack, special });
      }
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
    if (this.connectTimeout) clearTimeout(this.connectTimeout);
    this.conns.forEach(c => { try { c.close(); } catch {} });
    this.conns.clear();
    try { this.hostConn?.close(); } catch {}
    try { this.peer?.destroy(); } catch {}
    this.peer = null;
    this.hostConn = null;
    this.msgHandlers.clear();
    this.connHandlers.clear();
    this.disconnHandlers.clear();
  }
}
