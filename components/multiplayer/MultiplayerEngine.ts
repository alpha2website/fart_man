// ============================================================
// FART MAN — Multiplayer Arena Engine (City Block Maze Edition)
// Host-authoritative fighter: last player standing wins.
// ============================================================

import { PeerConnection, PlayerSnap, ProjSnap, NetMessage } from '@/lib/peerConnection';
import { SKINS } from '@/lib/gameConfig';
import { clamp } from '@/lib/physics';
import { ParticleSystem } from '@/components/game/Particles';
import { AudioManager } from '@/components/game/AudioManager';

// ── Arena (logical px — canvas transform handles screen scaling) ──

const ARENA_W = 900;
const ARENA_H = 540;

// Player is 36px radius so corridors of 100px are comfortable to walk through
const PLAYER_R   = 36;
const MOVE_SPEED = 3.2;   // slightly reduced so mobile feels smoother
const MAX_HP     = 100;

// Weapons
const ATTACK_CD  = 400;   // ms
const SPECIAL_CD = 3500;  // ms
const PROJ_SPEED = 8;
const PROJ_DMG   = 15;
const PROJ_LIFE  = 75;    // frames @ 60fps
const PROJ_R     = 12;
const BOMB_LIFE  = 55;
const BOMB_R     = 80;
const BOMB_DMG   = 28;

// ─────────────────────────────────────────────────────────────
// City-block maze walls
// Rule: every corridor is at least 100px wide so players (72px
// diameter) can always navigate. Walls are 20px thick.
//
// Layout (900×540):
//
//   ┌───────────────────────────────────────────────────────┐
//   │  [A1]      [B1]         [C1]      [D1]               │
//   │         ─────────   ─────────                         │
//   │  [A2]      [B2]         [C2]      [D2]               │
//   │         │                        │                    │
//   │  [A3]   │  [B3]         [C3]     │  [D3]             │
//   │         ─────────   ─────────                         │
//   │  [A4]      [B4]         [C4]      [D4]               │
//   └───────────────────────────────────────────────────────┘
//
// The maze creates a city-block pattern. Every path between
// spawn points is reachable.
// ─────────────────────────────────────────────────────────────

interface Wall { x: number; y: number; w: number; h: number; }

const W20 = 20;  // wall thickness

// ── Gap analysis for PLAYER_R=36 (diameter=72px):
//    Every corridor gap must be > 72px to walk through.
//    All gaps here are >= 110px.
const WALLS: Wall[] = [
  // ── Top horizontal walls — gap in centre (380-520 = 140px gap) ──
  { x: 160, y: 140, w: 220, h: W20 },   // top-left segment
  { x: 520, y: 140, w: 220, h: W20 },   // top-right segment

  // ── Bottom horizontal walls — same pattern ──
  { x: 160, y: 380, w: 220, h: W20 },
  { x: 520, y: 380, w: 220, h: W20 },

  // ── Left vertical wall — gap at y=270 (120px gap each side) ──
  { x: 340, y: 160, w: W20, h: 100 },   // top piece ends at y=260
  { x: 340, y: 280, w: W20, h: 100 },   // bottom piece starts at y=280

  // ── Right vertical wall — same ──
  { x: 540, y: 160, w: W20, h: 100 },
  { x: 540, y: 280, w: W20, h: 100 },

  // ── Centre island — wide enough to hide behind, gaps on all sides ──
  // Left side: x=340+20=360, right side: x=540 → gap is 540-360=180px ✓
  // Top: y=140+20=160, bottom of island=300, top of bottom wall=380 → gap 80px
  // So centre island sits at (420,220) 60×100
  { x: 420, y: 220, w: 60, h: 100 },
];

// ── Pre-computed wall fill color (no per-frame gradient creation) ──
const WALL_COLOR = '#2E4060';
const WALL_HIGHLIGHT = 'rgba(255,255,255,0.12)';
const WALL_BORDER = 'rgba(96,165,250,0.3)';
const SPAWNS = [
  { x: 80,  y: 80  },   // top-left corner
  { x: 820, y: 80  },   // top-right corner
  { x: 80,  y: 460 },   // bottom-left corner
  { x: 820, y: 460 },   // bottom-right corner
  { x: 450, y: 270 },   // centre
];

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface ArenaPlayer {
  slot: number;
  x: number; y: number;
  vx: number; vy: number;
  hp: number;
  alive: boolean;
  facing: number;
  name: string;
  skinId: string;
  faceDataUrl: string | null;
  faceImg: HTMLImageElement | null;
  isHost: boolean;
  attackCool: number;
  specialCool: number;
  invuln: number;
  hitFlash: number;
}

interface Projectile {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  kind: 'blast' | 'bomb';
  ownerId: number;
  life: number;
  radius: number;
}

export interface InputState {
  moveX: number; moveY: number;
  facing: number;
  attack: boolean; special: boolean;
}

// ─────────────────────────────────────────────────────────────

export class MultiplayerEngine {
  private canvas: HTMLCanvasElement;
  private ctx:    CanvasRenderingContext2D;
  private conn:   PeerConnection;
  private audio:  AudioManager;
  private particles: ParticleSystem;

  private players:     Map<number, ArenaPlayer> = new Map();
  private projectiles: Projectile[] = [];
  private projId = 1;

  private localInput:   InputState = { moveX:0, moveY:0, facing:1, attack:false, special:false };
  private remoteInputs: Map<number, InputState> = new Map();

  private frameId   = 0;
  private lastTime  = 0;
  private frameTime = 0;
  private stateTimer = 0;
  private running   = false;
  private matchOver = false;
  private winnerSlot = -1;
  private countdown  = 3;
  private countdownTimer = 0;
  private shake = 0;
  private elimFeed: { text: string; alpha: number }[] = [];

  constructor(canvas: HTMLCanvasElement, conn: PeerConnection, audio: AudioManager) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d')!;
    this.conn   = conn;
    this.audio  = audio;
    this.particles = new ParticleSystem();
  }

  // ── Public API ──────────────────────────────────────────────

  initMatch(infos: { id: number; name: string; skinId: string; faceDataUrl: string | null; isHost: boolean }[]): void {
    this.players.clear();
    this.projectiles = [];
    this.particles.clear();
    this.matchOver = false;
    this.winnerSlot = -1;
    this.countdown = 3;
    this.countdownTimer = 0;
    this.elimFeed = [];
    this.frameTime = 0;

    infos.forEach((info, i) => {
      const pos = SPAWNS[i % SPAWNS.length];
      this.players.set(info.id, {
        slot: info.id,
        x: pos.x, y: pos.y,
        vx: 0, vy: 0,
        hp: MAX_HP,
        alive: true,
        facing: pos.x < ARENA_W / 2 ? 1 : -1,
        name: info.name,
        skinId: info.skinId,
        faceDataUrl: info.faceDataUrl,
        faceImg: info.faceDataUrl ? this._loadImg(info.faceDataUrl) : null,
        isHost: info.isHost,
        attackCool: 0,
        specialCool: 0,
        invuln: 90,   // 1.5s spawn protection
        hitFlash: 0,
      });
    });
  }

  start(): void {
    this.running = true;
    this.lastTime = performance.now();
    this._loop(performance.now());
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
  }

  setLocalInput(input: InputState): void {
    this.localInput = { ...input };
    // Clients forward their input to the host over MQTT
    if (!this.conn.isHost) {
      this.conn.sendInput(input.moveX, input.moveY, input.facing, input.attack, input.special);
    }
  }

  onRemoteInput(slot: number, input: InputState): void {
    this.remoteInputs.set(slot, { ...input });
  }

  applyState(msg: any): void {
    if (this.conn.isHost) return;

    // Sync countdown
    if (typeof msg.countdown === 'number') this.countdown = msg.countdown;
    if (typeof msg.matchOver === 'boolean') this.matchOver = msg.matchOver;
    if (typeof msg.winnerSlot === 'number') this.winnerSlot = msg.winnerSlot;

    // Sync players
    (msg.players ?? []).forEach((snap: any) => {
      let p = this.players.get(snap.slot);
      if (!p) {
        p = {
          slot: snap.slot, x: snap.x, y: snap.y, vx: 0, vy: 0,
          hp: snap.hp, alive: snap.alive, facing: snap.facing,
          name: snap.name, skinId: snap.skinId,
          faceDataUrl: snap.faceDataUrl,
          faceImg: snap.faceDataUrl ? this._loadImg(snap.faceDataUrl) : null,
          isHost: snap.isHost, attackCool: 0, specialCool: 0,
          invuln: snap.invuln, hitFlash: snap.hitFlash,
        };
        this.players.set(snap.slot, p);
      }
      p.x = snap.x; p.y = snap.y;
      p.hp = snap.hp; p.alive = snap.alive;
      p.facing = snap.facing;
      p.attackCool = snap.attackCool ?? 0;
      p.specialCool = snap.specialCool ?? 0;
      p.invuln = snap.invuln ?? 0;
      p.hitFlash = snap.hitFlash ?? 0;
    });

    // Sync projectiles
    this.projectiles = (msg.projectiles ?? []).map((s: any) => ({
      id: s.id, x: s.x, y: s.y, vx: s.vx, vy: s.vy,
      kind: s.kind, ownerId: s.ownerId, life: s.life, radius: s.radius,
    }));
  }

  applyMatchOver(winnerSlot: number): void {
    this.matchOver  = true;
    this.winnerSlot = winnerSlot;
  }

  // ── Game loop ────────────────────────────────────────────────

  private _loop(ts: number): void {
    if (!this.running) return;
    const dt = Math.min(ts - this.lastTime, 50);
    this.lastTime   = ts;
    this.frameTime += dt;

    if (this.conn.isHost) {
      // Host: run physics every frame (60fps)
      this._hostUpdate(dt);
      this._render();
    } else {
      // Client: only render at ~30fps to save mobile CPU
      // Physics runs on host — clients just interpolate received state
      if (dt >= 16) {
        this._render();
      }
    }

    this.frameId = requestAnimationFrame(t => this._loop(t));
  }

  // ── Host simulation ──────────────────────────────────────────

  private _hostUpdate(dt: number): void {
    // Cap dtN at 1.5 (= 25ms frame) so slow mobile frames don't cause huge jumps
    const dtN = Math.min(dt / 16.667, 1.5);

    // ── Countdown ──
    if (this.countdown > 0) {
      this.countdownTimer += dt;
      if (this.countdownTimer >= 1000) {
        this.countdownTimer = 0;
        this.countdown--;
        this.audio.playFartSFX();
        this._broadcastState();
      }
      this.particles.update(dt);
      return;
    }

    if (this.matchOver) {
      this.particles.update(dt);
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dtN);
      return;
    }

    // ── Players ──
    this.players.forEach((p, slot) => {
      if (!p.alive) return;

      const inp: InputState = (slot === this.conn.slot)
        ? this.localInput
        : (this.remoteInputs.get(slot) ?? { moveX:0, moveY:0, facing:p.facing, attack:false, special:false });

      // Movement
      const spd = MOVE_SPEED * dtN;
      const len = Math.hypot(inp.moveX, inp.moveY);
      if (len > 0.05) {
        p.vx = (inp.moveX / Math.max(len, 1)) * spd;
        p.vy = (inp.moveY / Math.max(len, 1)) * spd;
        if (inp.moveX !== 0) p.facing = inp.moveX > 0 ? 1 : -1;
      } else {
        p.vx = 0; p.vy = 0;
      }

      // Move X, then resolve walls; move Y, then resolve walls separately
      // (axis-separated collision avoids corner sticking)
      p.x += p.vx;
      this._resolveWalls(p);
      p.y += p.vy;
      this._resolveWalls(p);
      p.x = clamp(p.x, PLAYER_R, ARENA_W - PLAYER_R);
      p.y = clamp(p.y, PLAYER_R, ARENA_H - PLAYER_R);

      // Cooldowns
      p.attackCool  = Math.max(0, p.attackCool  - dt);
      p.specialCool = Math.max(0, p.specialCool - dt);
      p.invuln      = Math.max(0, p.invuln      - dtN);
      p.hitFlash    = Math.max(0, p.hitFlash    - dtN);

      // ── Fart blast (attack) ──
      if (inp.attack && p.attackCool <= 0) {
        p.attackCool = ATTACK_CD;
        this.projectiles.push({
          id: this.projId++,
          x: p.x + p.facing * (PLAYER_R + 6), y: p.y,
          vx: p.facing * PROJ_SPEED, vy: 0,
          kind: 'blast', ownerId: slot,
          life: PROJ_LIFE, radius: PROJ_R,
        });
        this.audio.playFartSFX();
        this.particles.emit('fart_small', p.x, p.y, 3);  // reduced count for mobile perf
      }

      // ── Gas bomb (special) ──
      if (inp.special && p.specialCool <= 0) {
        p.specialCool = SPECIAL_CD;
        this.projectiles.push({
          id: this.projId++,
          x: p.x + p.facing * (PLAYER_R + 6), y: p.y - 6,
          vx: p.facing * 5, vy: -4,
          kind: 'bomb', ownerId: slot,
          life: BOMB_LIFE, radius: 10,
        });
        this.audio.playFartSFX();
      }
    });

    // ── Projectiles ──
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      if (proj.kind === 'bomb') proj.vy += 0.3 * dtN;
      proj.x += proj.vx * dtN;
      proj.y += proj.vy * dtN;
      proj.life -= dtN;

      // Wall hit
      let dead = false;
      for (const w of WALLS) {
        const nx = clamp(proj.x, w.x, w.x + w.w);
        const ny = clamp(proj.y, w.y, w.y + w.h);
        if (Math.hypot(proj.x - nx, proj.y - ny) < proj.radius) {
          if (proj.kind === 'bomb') this._boom(proj);
          dead = true; break;
        }
      }

      // Bomb natural expiry
      if (!dead && proj.kind === 'bomb' && proj.life <= 0) {
        this._boom(proj); dead = true;
      }

      // Player hit
      if (!dead) {
        this.players.forEach((p, slot) => {
          if (dead || !p.alive || p.invuln > 0 || slot === proj.ownerId) return;
          if (Math.hypot(p.x - proj.x, p.y - proj.y) < PLAYER_R + proj.radius) {
            if (proj.kind === 'blast') { this._hit(slot, PROJ_DMG, proj.ownerId, proj.vx > 0 ? 1 : -1); dead = true; }
            else if (proj.kind === 'bomb') { this._boom(proj); dead = true; }
          }
        });
      }

      if (dead || proj.life <= 0
        || proj.x < -30 || proj.x > ARENA_W + 30
        || proj.y < -30 || proj.y > ARENA_H + 30) {
        this.projectiles.splice(i, 1);
      }
    }

    // ── P vs P push-apart ──
    const alive = [...this.players.values()].filter(p => p.alive);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = PLAYER_R * 2;
        if (d < min && d > 0) {
          const push = (min - d) / 2;
          a.x -= (dx / d) * push; a.y -= (dy / d) * push;
          b.x += (dx / d) * push; b.y += (dy / d) * push;
        }
      }
    }

    this.particles.update(dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dtN);    this.elimFeed.forEach(e => e.alpha -= 0.006 * dtN);
    this.elimFeed = this.elimFeed.filter(e => e.alpha > 0);

    // Win check
    if (alive.length <= 1 && !this.matchOver) {
      this.matchOver = true;
      this.winnerSlot = alive.length === 1 ? alive[0].slot : -1;
      const winName = alive.length === 1 ? alive[0].name : 'Nobody';
      this.conn.broadcastMatchOver(this.winnerSlot, winName);
      this.shake = 20;
    }

    // State broadcast @20Hz (50ms) — good balance of responsiveness vs MQTT traffic
    this.stateTimer += dt;
    if (this.stateTimer >= 50) { this.stateTimer = 0; this._broadcastState(); }
  }

  // ── Axis-separated wall resolution ──
  private _resolveWalls(p: ArenaPlayer): void {
    for (const w of WALLS) {
      const nx = clamp(p.x, w.x, w.x + w.w);
      const ny = clamp(p.y, w.y, w.y + w.h);
      const dx = p.x - nx, dy = p.y - ny;
      const d  = Math.hypot(dx, dy);
      if (d < PLAYER_R && d > 0) {
        const push = PLAYER_R - d;
        p.x += (dx / d) * push;
        p.y += (dy / d) * push;
      } else if (d === 0) {
        // Dead centre — push out upward
        p.y = w.y - PLAYER_R;
      }
    }
  }

  private _hit(slot: number, dmg: number, attackerSlot: number, dir: number): void {
    const p = this.players.get(slot);
    if (!p || !p.alive || p.invuln > 0) return;
    p.hp       -= dmg;
    p.hitFlash  = 12;
    p.invuln    = 18;
    p.vx       += dir * 5;
    p.vy       -= 2;
    this.particles.emit('fart_big', p.x, p.y, 6);
    this.shake  = Math.max(this.shake, 8);
    if (p.hp <= 0) {
      p.hp = 0; p.alive = false;
      this.particles.emit('crash_star', p.x, p.y, 16);
      this.shake = 16;
      this.conn.broadcastEliminated(slot);
      const atk = this.players.get(attackerSlot);
      this.elimFeed.push({ text: `${atk?.name ?? '?'} eliminated ${p.name}! 💨`, alpha: 1 });
    }
  }

  private _boom(proj: Projectile): void {
    this.particles.emit('fart_big',    proj.x, proj.y, 14);
    this.particles.emit('boost_burst', proj.x, proj.y, 8);
    this.shake = Math.max(this.shake, 12);
    this.players.forEach((p, slot) => {
      if (!p.alive || p.invuln > 0 || slot === proj.ownerId) return;
      const dx = p.x - proj.x, dy = p.y - proj.y;
      const d  = Math.hypot(dx, dy);
      if (d < BOMB_R) {
        const dir = d > 0 ? dx / d : 1;
        this._hit(slot, BOMB_DMG, proj.ownerId, dir);
        p.vx += (dx / Math.max(d, 1)) * 9;
        p.vy += (dy / Math.max(d, 1)) * 9;
      }
    });
  }

  private _broadcastState(): void {
    // NOTE: faceDataUrl intentionally excluded — clients got it at initMatch.
    // Excluding it halves the payload size on every state update.
    const snaps = [...this.players.values()].map(p => ({
      slot: p.slot, x: Math.round(p.x), y: Math.round(p.y),
      hp: Math.round(p.hp), alive: p.alive, facing: p.facing,
      name: p.name, skinId: p.skinId,
      attackCool: Math.round(p.attackCool),
      specialCool: Math.round(p.specialCool),
      invuln: Math.round(p.invuln), hitFlash: Math.round(p.hitFlash),
      isHost: p.isHost,
    }));
    const projSnaps = this.projectiles.map(p => ({
      id: p.id,
      x: Math.round(p.x), y: Math.round(p.y),
      vx: Math.round(p.vx * 10) / 10, vy: Math.round(p.vy * 10) / 10,
      kind: p.kind, ownerId: p.ownerId,
      life: Math.round(p.life), radius: p.radius,
    }));
    this.conn.broadcastState({
      t: 'state',
      players: snaps,
      projectiles: projSnaps,
      timeLeft: 0,
      alive: snaps.filter(s => s.alive).length,
      countdown: this.countdown,
      matchOver: this.matchOver,
      winnerSlot: this.winnerSlot,
    } as any);
  }

  // ── Rendering (called every frame on all clients) ───────────

  // Pre-cached background canvas drawn once, reused every frame
  private _bgCache: HTMLCanvasElement | null = null;

  private _buildBgCache(): void {
    const bg = document.createElement('canvas');
    bg.width  = ARENA_W;
    bg.height = ARENA_H;
    const ctx = bg.getContext('2d')!;

    // Background gradient
    const g = ctx.createLinearGradient(0, 0, 0, ARENA_H);
    g.addColorStop(0,   '#131520');
    g.addColorStop(0.5, '#1A1F35');
    g.addColorStop(1,   '#0E1A30');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);

    // Floor tile grid
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let x = 0; x < ARENA_W; x += 60) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ARENA_H); ctx.stroke();
    }
    for (let y = 0; y < ARENA_H; y += 60) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ARENA_W, y); ctx.stroke();
    }

    // Arena border
    ctx.strokeStyle = '#FDE047';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, ARENA_W - 4, ARENA_H - 4);

    // Maze walls — drawn once, flat fill
    for (const w of WALLS) {
      ctx.fillStyle = WALL_COLOR;
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.fillStyle = WALL_HIGHLIGHT;
      ctx.fillRect(w.x, w.y, w.w, 3);
      ctx.strokeStyle = WALL_BORDER;
      ctx.lineWidth = 1;
      ctx.strokeRect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1);
    }

    this._bgCache = bg;
  }

  private _render(): void {
    const { ctx } = this;
    const W = ARENA_W, H = ARENA_H;

    // Build background cache once
    if (!this._bgCache) this._buildBgCache();

    ctx.save();
    if (this.shake > 0) {
      ctx.translate(
        (Math.random() - 0.5) * this.shake,
        (Math.random() - 0.5) * this.shake * 0.4,
      );
    }

    // ── Draw cached background (single drawImage call) ──
    ctx.drawImage(this._bgCache!, 0, 0);

    // ── Particles ──
    this.particles.draw(ctx);

    // ── Projectiles ──
    for (const proj of this.projectiles) this._drawProj(ctx, proj);

    // ── Players ──
    for (const p of this.players.values()) this._drawPlayer(ctx, p);

    // ── Elim feed ──
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    this.elimFeed.forEach((e, i) => {
      ctx.globalAlpha = e.alpha;
      ctx.fillStyle = '#F87171';
      ctx.font = 'bold 17px Arial';
      ctx.fillText(e.text, W / 2, 28 + i * 26);
    });
    ctx.globalAlpha = 1;

    // ── Countdown overlay ──
    if (this.countdown > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#FDE047';
      ctx.font = 'bold 130px Arial';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${this.countdown}`, W / 2, H / 2 - 20);
      ctx.font = 'bold 26px Arial';
      ctx.fillStyle = '#fff';
      ctx.fillText('GET READY TO FART! 💨', W / 2, H / 2 + 70);
    }

    // ── Match over overlay ──
    if (this.matchOver) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, 0, W, H);
      const winner = this.winnerSlot >= 0 ? this.players.get(this.winnerSlot) : null;
      ctx.fillStyle = '#FDE047';
      ctx.font = 'bold 58px Arial';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🏆 WINNER! 🏆', W / 2, H / 2 - 40);
      ctx.font = 'bold 34px Arial'; ctx.fillStyle = '#fff';
      ctx.fillText(winner ? winner.name : "It's a draw!", W / 2, H / 2 + 20);
      if (winner) {
        ctx.font = '20px Arial'; ctx.fillStyle = '#86EFAC';
        ctx.fillText('is the GAS MASTER! 💨', W / 2, H / 2 + 58);
      }
    }

    ctx.restore();
  }

  private _drawProj(ctx: CanvasRenderingContext2D, proj: Projectile): void {
    // No shadow — flat colours only for mobile perf
    const angle = Math.atan2(proj.vy, proj.vx);

    if (proj.kind === 'blast') {
      ctx.fillStyle = '#5EE898';
      ctx.beginPath(); ctx.arc(proj.x, proj.y, proj.radius, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#A855F7';
      ctx.beginPath(); ctx.arc(proj.x, proj.y, proj.radius, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#EC4899';
      ctx.beginPath(); ctx.arc(proj.x, proj.y, proj.radius * 0.45, 0, Math.PI * 2); ctx.fill();
      if (proj.life < 20) {
        ctx.strokeStyle = '#EF4444'; ctx.lineWidth = 2;
        ctx.globalAlpha = 1 - proj.life / 20;
        ctx.beginPath(); ctx.arc(proj.x, proj.y, BOMB_R * (1 - proj.life / 20), 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    // Direction arrow
    ctx.save();
    ctx.translate(proj.x + proj.vx * 2, proj.y + proj.vy * 2);
    ctx.rotate(angle);
    ctx.fillStyle = proj.kind === 'blast' ? 'rgba(94,232,152,0.9)' : 'rgba(168,85,247,0.9)';
    ctx.beginPath();
    ctx.moveTo(14, 0); ctx.lineTo(3, -5); ctx.lineTo(3, 5);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  private _drawPlayer(ctx: CanvasRenderingContext2D, p: ArenaPlayer): void {
    if (!p.alive) return;
    const skin = SKINS.find(s => s.id === p.skinId) ?? SKINS[0];
    const R = PLAYER_R;
    const alpha = (p.invuln > 0 && Math.floor(p.invuln) % 4 < 2) ? 0.45 : 1;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.globalAlpha = alpha;

    // Hit flash — solid white outline instead of shadowBlur (much cheaper)
    if (p.hitFlash > 0) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(0, 0, R * 0.72, 0, Math.PI * 2); ctx.fill();
    }

    // Cape (simple rect, no ellipse)
    ctx.fillStyle = skin.capeColor;
    const capeX = -p.facing * (R * 0.6 + 8);
    ctx.fillRect(capeX, -R * 0.5, 16, R * 1.0);

    // Body — simple rect (no roundRect)
    ctx.fillStyle = skin.suitColor;
    ctx.fillRect(-R * 0.55, -R * 0.25, R * 1.1, R * 0.75);

    // Belt
    ctx.fillStyle = skin.beltColor;
    ctx.fillRect(-R * 0.5, R * 0.2, R * 1.0, 6);

    // Head
    ctx.fillStyle = skin.bodyColor;
    ctx.beginPath(); ctx.arc(0, -R * 0.5, R * 0.52, 0, Math.PI * 2); ctx.fill();

    // Face
    const faceR = R * 0.48;
    const faceY = -R * 0.5;
    if (p.faceImg?.complete && p.faceImg.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath(); ctx.arc(0, faceY, faceR, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(p.faceImg, -faceR, faceY - faceR, faceR * 2, faceR * 2);
      ctx.restore();
    } else {
      // Simple eyes (2 circles, no stroke)
      const ex = 6 * p.facing;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-ex, faceY - 3, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( ex, faceY - 3, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.arc(-ex + p.facing, faceY - 3, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( ex + p.facing, faceY - 3, 2.5, 0, Math.PI * 2); ctx.fill();
    }

    // Mask
    ctx.fillStyle = '#DC2626';
    ctx.fillRect(-R * 0.38, faceY - 8, R * 0.76, 7);

    ctx.globalAlpha = 1;
    ctx.restore();

    // ── Health bar ──
    const bw = 70, bh = 10;
    const bx = p.x - bw / 2, by = p.y - R - 22;
    ctx.fillStyle = '#000';
    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = '#333';
    ctx.fillRect(bx, by, bw, bh);
    const hpPct = Math.max(0, p.hp / MAX_HP);
    ctx.fillStyle = hpPct > 0.55 ? '#22C55E' : hpPct > 0.3 ? '#FBBF24' : '#EF4444';
    ctx.fillRect(bx, by, bw * hpPct, bh);
    // Name above bar
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(p.name, p.x, by - 2);
    // Slot tag
    ctx.fillStyle = '#FDE047'; ctx.font = 'bold 9px Arial';
    ctx.fillText(`P${p.slot + 1}`, p.x, by - 14);
    // Special cooldown ring — only when active
    if (p.specialCool > 0) {
      const pct = p.specialCool / SPECIAL_CD;
      ctx.strokeStyle = '#A855F7'; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - pct));
      ctx.stroke();
    }
  }

  private _loadImg(src: string): HTMLImageElement {
    const img = new Image(); img.src = src; return img;
  }

  get isMatchOver(): boolean { return this.matchOver; }
  get countdownVal(): number { return this.countdown; }
}
