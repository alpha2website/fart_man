// ============================================================
// FART MAN — Peer-to-Peer Networking Layer
// Uses PeerJS (WebRTC) for device-to-device multiplayer.
// The public PeerJS broker only handles signaling — no game data
// passes through any server. All gameplay is P2P.
// ============================================================

import { SkinDef } from './gameConfig';

// ── Types ──

export type Role = 'host' | 'client';

export interface PlayerNetInfo {
  id: number;            // slot 0-4
  peerId: string;        // PeerJS peer id
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
  facing: number;        // -1 left, +1 right
  name: string;
  skinId: string;
  faceDataUrl: string | null;
  attackCool: number;    // 0 = ready
  specialCool: number;
  invuln: number;        // invulnerability frames remaining
  hitFlash: number;      // white flash on hit
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

// ── Helper: generate a short room code ──

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `FM${code}`;
}

// ── PeerConnection class ──

export class PeerConnection {
  private peer: any = null;           // PeerJS instance
  private role: Role = 'host';
  private roomId = '';
  private conns: Map<number, any> = new Map();  // slot → DataConnection
  private hostConn: any = null;                  // client's connection to host
  private mySlot = 0;
  private myName = 'Player';
  private mySkinId = 'default';
  private myFaceDataUrl: string | null = null;

  private msgHandlers: Set<MsgHandler> = new Set();
  private connHandlers: Set<ConnHandler> = new Set();
  private disconnHandlers: Set<ConnHandler> = new Set();

  // Player registry (host maintains)
  private players: PlayerNetInfo[] = [];
  private nextSlot = 1;

  // ── Setup ──

  setMyInfo(name: string, skinId: string, faceDataUrl: string | null): void {
    this.myName = name;
    this.mySkinId = skinId;
    this.myFaceDataUrl = faceDataUrl;
  }

  // ── Host: create room ──

  async hostRoom(): Promise<string> {
    this.role = 'host';
    this.roomId = generateRoomCode();

    const Peer = (await import('peerjs')).default;
    this.peer = new Peer(this.roomId, {
      debug: 1,
    });

    return new Promise((resolve, reject) => {
      if (!this.peer) { reject(new Error('Peer not created')); return; }

      this.peer.on('open', () => {
        // Register self as slot 0
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
        console.error('[Peer] error:', err);
        if (err.type === 'unavailable-id') {
          // ID taken, try again
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

  // ── Client: join room ──

  async joinRoom(roomId: string): Promise<void> {
    this.role = 'client';
    this.roomId = roomId;

    const Peer = (await import('peerjs')).default;
    this.peer = new Peer({ debug: 1 });

    return new Promise((resolve, reject) => {
      if (!this.peer) { reject(new Error('Peer not created')); return; }

      this.peer.on('open', () => {
        // Connect to host
        const conn = this.peer.connect(roomId, { reliable: false, serialization: 'json' });

        conn.on('open', () => {
          this.hostConn = conn;
          // Send join message
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
          console.error('[Peer] conn error:', err);
          reject(err);
        });
      });

      this.peer.on('error', (err: any) => {
        console.error('[Peer] error:', err);
        reject(err);
      });
    });
  }

  // ── Host: handle incoming client connection ──

  private _handleClientConn(conn: any): void {
    conn.on('open', () => {
      // Will assign slot when we receive the join message
    });

    conn.on('data', (data: NetMessage) => {
      if (data.t === 'join') {
        // Assign a slot
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

        // Send ack to the new client
        conn.send({ t: 'joinAck', yourSlot: slot, players: this.players });

        // Broadcast lobby update to all clients
        this._broadcastLobby();

        // Notify our own UI
        this.connHandlers.forEach(h => h());
      } else if (data.t === 'input') {
        // Forward to game logic
        // We need to know which slot this is from
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
      try { conn.send(msg); } catch { /* ignore */ }
    });
  }

  private _broadcastLobby(): void {
    this._broadcast({ t: 'lobbyUpdate', players: this.players });
    // Also notify local host UI
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

  // ── Host: broadcast elimination ──

  broadcastEliminated(slot: number): void {
    this._broadcast({ t: 'eliminated', slot });
  }

  // ── Host: broadcast match over ──

  broadcastMatchOver(winnerSlot: number, winnerName: string): void {
    this._broadcast({ t: 'matchOver', winnerSlot, winnerName });
    this._dispatch({ t: 'matchOver', winnerSlot, winnerName });
  }

  // ── Client: send input to host ──

  sendInput(moveX: number, moveY: number, facing: number, attack: boolean, special: boolean): void {
    if (this.role !== 'client' || !this.hostConn) return;
    try {
      this.hostConn.send({ t: 'input', moveX, moveY, facing, attack, special });
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
