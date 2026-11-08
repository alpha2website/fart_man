// ============================================================
// FART MAN — Multiplayer Arena Engine
// Host-authoritative: host runs the simulation, clients send inputs.
// Last player standing wins!
// ============================================================

import { PeerConnection, PlayerSnap, ProjSnap, NetMessage } from '@/lib/peerConnection';
import { SKINS, SkinDef } from '@/lib/gameConfig';
import { randFloat, clamp } from '@/lib/physics';
import { ParticleSystem } from '@/components/game/Particles';
import { AudioManager } from '@/components/game/AudioManager';

// ── Arena constants ──

const ARENA_W = 900;
const ARENA_H = 560;
const PLAYER_R = 40;          // enlarged for better visibility
const MOVE_SPEED = 3.5;
const MAX_HP = 100;

// Weapon cooldowns (ms)
const ATTACK_CD = 350;
const SPECIAL_CD = 3000;
const PROJ_SPEED = 7;
const PROJ_DMG = 12;
const PROJ_LIFE = 80;
const PROJ_R = 14;
const BOMB_LIFE = 50;
const BOMB_R = 70;            // bigger explosion
const BOMB_DMG = 25;
const DASH_SPEED = 12;
const DASH_LIFE = 12;
const DASH_DMG = 18;

// ── Pentagon maze walls ──
// Each wall is a rectangle {x, y, w, h}
// The pentagon boundary is visual; walls create the maze inside

interface MazeWall { x: number; y: number; w: number; h: number; }

// Pentagon corners (5 spawn points)
const PENTAGON_CORNERS = [
  { x: 450, y: 80 },    // top
  { x: 760, y: 230 },   // top-right
  { x: 640, y: 490 },   // bottom-right
  { x: 260, y: 490 },   // bottom-left
  { x: 140, y: 230 },   // top-left
];

// Pentagon vertices for drawing
const PENTAGON_VERTICES = PENTAGON_CORNERS.map(c => ({ x: c.x, y: c.y }));

// Maze walls — create corridors between the 5 corners
const MAZE_WALLS: MazeWall[] = [
  // Central pentagon ring (inner walls)
  { x: 370, y: 220, w: 160, h: 16 },  // top inner wall
  { x: 530, y: 250, w: 16, h: 100 },  // right inner wall
  { x: 430, y: 340, w: 120, h: 16 },  // bottom inner wall
  { x: 354, y: 250, w: 16, h: 100 },  // left inner wall

  // Corridor walls — create paths between corners
  { x: 200, y: 140, w: 140, h: 16 },  // top-left corridor
  { x: 560, y: 140, w: 140, h: 16 },  // top-right corridor
  { x: 180, y: 360, w: 100, h: 16 },  // bottom-left corridor
  { x: 620, y: 360, w: 100, h: 16 },  // bottom-right corridor
  { x: 430, y: 100, w: 16, h: 80 },   // top vertical corridor
  { x: 100, y: 250, w: 16, h: 100 },  // left vertical
  { x: 780, y: 250, w: 16, h: 100 },  // right vertical

  // Small obstacles in open areas
  { x: 280, y: 280, w: 80, h: 16 },
  { x: 540, y: 280, w: 80, h: 16 },
  { x: 440, y: 420, w: 16, h: 50 },
];

// ── Types ──

interface ArenaPlayer {
  slot: number;
  x: number; y: number;
  vx: number; vy: number;
  hp: number;
  alive: boolean;
  facing: number;         // -1 or +1
  name: string;
  skinId: string;
  faceDataUrl: string | null;
  faceImg: HTMLImageElement | null;
  isHost: boolean;
  attackCool: number;
  specialCool: number;
  invuln: number;
  hitFlash: number;
  dashTimer: number;
}

interface Projectile {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  kind: 'blast' | 'bomb' | 'dash';
  ownerId: number;
  life: number;
  radius: number;
}

interface InputState {
  moveX: number;
  moveY: number;
  facing: number;
  attack: boolean;
  special: boolean;
}

// ── Engine ──

export class MultiplayerEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private conn: PeerConnection;
  private audio: AudioManager;
  private particles: ParticleSystem;

  private players: Map<number, ArenaPlayer> = new Map();
  private projectiles: Projectile[] = [];
  private projId = 1;

  // Inputs: host gets local input + receives remote inputs
  private localInput: InputState = { moveX: 0, moveY: 0, facing: 1, attack: false, special: false };
  private remoteInputs: Map<number, InputState> = new Map();

  private frameId = 0;
  private lastTime = 0;
  private frameTime = 0;
  private stateTimer = 0;
  private running = false;
  private matchOver = false;
  private winnerSlot = -1;
  private countdown = 3;     // 3-2-1 countdown before match starts
  private countdownTimer = 0;

  // Screen shake
  private shake = 0;

  // Elimination feed
  private elimFeed: { text: string; alpha: number }[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    conn: PeerConnection,
    audio: AudioManager
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.conn = conn;
    this.audio = audio;
    this.particles = new ParticleSystem();
  }

  // ── Public API ──

  initMatch(playerInfos: { id: number; name: string; skinId: string; faceDataUrl: string | null; isHost: boolean }[]): void {
    this.players.clear();
    this.projectiles = [];
    this.particles.clear();
    this.matchOver = false;
    this.winnerSlot = -1;
    this.countdown = 3;
    this.countdownTimer = 0;

    // Spawn positions at pentagon corners
    const positions = PENTAGON_CORNERS;

    playerInfos.forEach((info, i) => {
      const pos = positions[i % positions.length];
      const faceImg = info.faceDataUrl ? this._loadFace(info.faceDataUrl) : null;
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
        faceImg,
        isHost: info.isHost,
        attackCool: 0,
        specialCool: 0,
        invuln: 60,     // brief spawn protection
        hitFlash: 0,
        dashTimer: 0,
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

  setLocalInput(input: Partial<InputState>): void {
    Object.assign(this.localInput, input);
    // If client, send to host
    if (!this.conn.isHost) {
      this.conn.sendInput(
        this.localInput.moveX,
        this.localInput.moveY,
        this.localInput.facing,
        this.localInput.attack,
        this.localInput.special
      );
    }
  }

  // Host receives remote input from a specific slot
  onRemoteInput(slot: number, input: InputState): void {
    this.remoteInputs.set(slot, input);
  }

  // ── Game loop ──

  private _loop(ts: number): void {
    if (!this.running) return;
    const dt = Math.min(ts - this.lastTime, 50);
    this.lastTime = ts;
    this.frameTime += dt;

    if (this.conn.isHost) {
      this._hostUpdate(dt);
    }

    this._render();
    this.frameId = requestAnimationFrame((t) => this._loop(t));
  }

  // ── Host: update simulation ──

  private _hostUpdate(dt: number): void {
    const dtN = dt / 16.67;

    // Countdown
    if (this.countdown > 0) {
      this.countdownTimer += dt;
      if (this.countdownTimer >= 1000) {
        this.countdownTimer = 0;
        this.countdown--;
        this.audio.playFartSFX();
      }
      // Still update particles
      this.particles.update(dt);
      return;
    }

    if (this.matchOver) {
      this.particles.update(dt);
      if (this.shake > 0) this.shake = Math.max(0, this.shake - 0.8 * dtN);
      return;
    }

    // Process each player
    this.players.forEach((p, slot) => {
      if (!p.alive) return;

      // Get input for this player
      let input: InputState;
      if (this.conn.isHost && slot === this.conn.slot) {
        input = this.localInput;
      } else {
        input = this.remoteInputs.get(slot) ?? { moveX: 0, moveY: 0, facing: p.facing, attack: false, special: false };
      }

      // Movement
      const len = Math.hypot(input.moveX, input.moveY);
      if (len > 0.1) {
        const nx = input.moveX / Math.max(len, 1);
        const ny = input.moveY / Math.max(len, 1);
        if (p.dashTimer <= 0) {
          p.vx = nx * MOVE_SPEED;
          p.vy = ny * MOVE_SPEED;
        }
        if (input.moveX !== 0) p.facing = input.moveX > 0 ? 1 : -1;
      } else {
        p.vx *= 0.85;
        p.vy *= 0.85;
      }

      // Dash
      if (p.dashTimer > 0) {
        p.dashTimer -= dtN;
        p.invuln = Math.max(p.invuln, 1);
      }

      // Apply velocity
      p.x += p.vx * dtN;
      p.y += p.vy * dtN;
      p.x = clamp(p.x, PLAYER_R, ARENA_W - PLAYER_R);
      p.y = clamp(p.y, PLAYER_R, ARENA_H - PLAYER_R);

      // ── Wall collision — push player out of maze walls ──
      for (const wall of MAZE_WALLS) {
        const nearestX = clamp(p.x, wall.x, wall.x + wall.w);
        const nearestY = clamp(p.y, wall.y, wall.y + wall.h);
        const dx = p.x - nearestX;
        const dy = p.y - nearestY;
        const dist = Math.hypot(dx, dy);
        if (dist < PLAYER_R && dist > 0) {
          const push = PLAYER_R - dist;
          p.x += (dx / dist) * push;
          p.y += (dy / dist) * push;
        } else if (dist === 0) {
          // Player center is inside the wall — push up
          p.y = wall.y - PLAYER_R;
        }
      }

      // Cooldowns
      p.attackCool = Math.max(0, p.attackCool - dt);
      p.specialCool = Math.max(0, p.specialCool - dt);
      p.invuln = Math.max(0, p.invuln - dtN);
      p.hitFlash = Math.max(0, p.hitFlash - dtN);

      // Attack (fart blaster)
      if (input.attack && p.attackCool <= 0 && p.dashTimer <= 0) {
        p.attackCool = ATTACK_CD;
        const px = p.x + p.facing * (PLAYER_R + 5);
        const py = p.y - 4;
        this.projectiles.push({
          id: this.projId++,
          x: px, y: py,
          vx: p.facing * PROJ_SPEED, vy: 0,
          kind: 'blast', ownerId: slot,
          life: PROJ_LIFE, radius: PROJ_R,
        });
        this.audio.playFartSFX();
        this.particles.emit('fart_small', px, py, 4);
      }

      // Special (gas bomb or dash)
      if (input.special && p.specialCool <= 0) {
        p.specialCool = SPECIAL_CD;
        // Gas bomb: throw a projectile that explodes
        const bx = p.x + p.facing * (PLAYER_R + 5);
        const by = p.y - 4;
        this.projectiles.push({
          id: this.projId++,
          x: bx, y: by,
          vx: p.facing * 5, vy: -3,
          kind: 'bomb', ownerId: slot,
          life: BOMB_LIFE, radius: 8,
        });
        this.audio.playFartSFX();
      }
    });

    // Update projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];

      if (proj.kind === 'bomb') {
        // Bomb has gravity
        proj.vy += 0.25 * dtN;
      }

      proj.x += proj.vx * dtN;
      proj.y += proj.vy * dtN;
      proj.life -= dtN;

      // ── Projectile vs wall collision ──
      let hitWall = false;
      for (const wall of MAZE_WALLS) {
        const nearestX = clamp(proj.x, wall.x, wall.x + wall.w);
        const nearestY = clamp(proj.y, wall.y, wall.y + wall.h);
        if (Math.hypot(proj.x - nearestX, proj.y - nearestY) < proj.radius) {
          if (proj.kind === 'bomb') {
            this._explodeBomb(proj);
          }
          hitWall = true;
          break;
        }
      }

      // Bomb explosion
      if (proj.kind === 'bomb' && proj.life <= 0) {
        this._explodeBomb(proj);
        this.projectiles.splice(i, 1);
        continue;
      }

      // Hit detection
      let hit = false;
      this.players.forEach((p, slot) => {
        if (!p.alive || p.invuln > 0 || slot === proj.ownerId) return;
        const dx = p.x - proj.x;
        const dy = p.y - proj.y;
        if (Math.hypot(dx, dy) < PLAYER_R + proj.radius) {
          if (proj.kind === 'blast') {
            this._damagePlayer(slot, PROJ_DMG, proj.ownerId, p.facing);
            hit = true;
          } else if (proj.kind === 'bomb') {
            this._explodeBomb(proj);
            hit = true;
          }
        }
      });

      // Out of bounds or expired or hit wall
      if (hitWall || hit || proj.life <= 0 || proj.x < -20 || proj.x > ARENA_W + 20 || proj.y < -20 || proj.y > ARENA_H + 20) {
        this.projectiles.splice(i, 1);
      }
    }

    // Player vs player collision (push apart)
    const alivePlayers = [...this.players.values()].filter(p => p.alive);
    for (let i = 0; i < alivePlayers.length; i++) {
      for (let j = i + 1; j < alivePlayers.length; j++) {
        const a = alivePlayers[i], b = alivePlayers[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const minDist = PLAYER_R * 2;
        if (dist < minDist && dist > 0) {
          const push = (minDist - dist) / 2;
          const nx = dx / dist, ny = dy / dist;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
        }
      }
    }

    // Update particles
    this.particles.update(dt);

    // Screen shake
    if (this.shake > 0) this.shake = Math.max(0, this.shake - 0.8 * dtN);

    // Elim feed fade
    this.elimFeed.forEach(e => e.alpha -= 0.005 * dtN);
    this.elimFeed = this.elimFeed.filter(e => e.alpha > 0);

    // Check win condition
    const alive = alivePlayers;
    if (alive.length <= 1 && !this.matchOver) {
      this.matchOver = true;
      this.winnerSlot = alive.length === 1 ? alive[0].slot : -1;
      const winnerName = alive.length === 1 ? alive[0].name : 'Nobody';
      this.conn.broadcastMatchOver(this.winnerSlot, winnerName);
      this.shake = 20;
    }

    // Broadcast state to clients (~30Hz)
    this.stateTimer += dt;
    if (this.stateTimer >= 33) {
      this.stateTimer = 0;
      this._broadcastState();
    }
  }

  private _damagePlayer(slot: number, dmg: number, attackerSlot: number, knockDir: number): void {
    const p = this.players.get(slot);
    if (!p || !p.alive || p.invuln > 0) return;
    p.hp -= dmg;
    p.hitFlash = 10;
    p.invuln = 15;  // brief i-frames
    // Knockback
    p.vx += knockDir * 4;
    p.vy -= 2;

    this.particles.emit('fart_big', p.x, p.y, 5);
    this.shake = Math.max(this.shake, 6);

    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      this.particles.emit('crash_star', p.x, p.y, 16);
      this.particles.emit('fart_big', p.x, p.y, 10);
      this.shake = 14;
      this.conn.broadcastEliminated(slot);
      const attacker = this.players.get(attackerSlot);
      this.elimFeed.push({
        text: `${attacker?.name ?? '???'} eliminated ${p.name}!`,
        alpha: 1,
      });
    }
  }

  private _explodeBomb(proj: Projectile): void {
    this.particles.emit('fart_big', proj.x, proj.y, 12);
    this.particles.emit('boost_burst', proj.x, proj.y, 8);
    this.shake = Math.max(this.shake, 10);

    this.players.forEach((p, slot) => {
      if (!p.alive || p.invuln > 0 || slot === proj.ownerId) return;
      const dx = p.x - proj.x, dy = p.y - proj.y;
      const dist = Math.hypot(dx, dy);
      if (dist < BOMB_R) {
        const dir = dist > 0 ? dx / dist : 1;
        this._damagePlayer(slot, BOMB_DMG, proj.ownerId, dir);
        // Extra knockback
        p.vx += (dx / Math.max(dist, 1)) * 8;
        p.vy += (dy / Math.max(dist, 1)) * 8;
      }
    });
  }

  private _broadcastState(): void {
    const playerSnaps: PlayerSnap[] = [...this.players.values()].map(p => ({
      slot: p.slot, x: p.x, y: p.y, vx: p.vx, vy: p.vy,
      hp: p.hp, maxHp: MAX_HP, alive: p.alive,
      facing: p.facing, name: p.name, skinId: p.skinId,
      faceDataUrl: p.faceDataUrl,
      attackCool: p.attackCool, specialCool: p.specialCool,
      invuln: p.invuln, hitFlash: p.hitFlash, isHost: p.isHost,
    }));
    const projSnaps: ProjSnap[] = this.projectiles.map(p => ({
      id: p.id, x: p.x, y: p.y, vx: p.vx, vy: p.vy,
      kind: p.kind, ownerId: p.ownerId, life: p.life, radius: p.radius,
    }));

    const aliveCount = [...this.players.values()].filter(p => p.alive).length;
    this.conn.broadcastState({
      t: 'state',
      players: playerSnaps,
      projectiles: projSnaps,
      timeLeft: 0, alive: aliveCount,
    });
  }

  // ── Client: receive state update ──

  applyState(msg: Extract<NetMessage, { t: 'state' }>): void {
    if (this.conn.isHost) return;  // host already has the state

    // Update players
    msg.players.forEach(snap => {
      let p = this.players.get(snap.slot);
      if (!p) {
        p = {
          slot: snap.slot, x: snap.x, y: snap.y, vx: 0, vy: 0,
          hp: snap.hp, alive: snap.alive, facing: snap.facing,
          name: snap.name, skinId: snap.skinId,
          faceDataUrl: snap.faceDataUrl,
          faceImg: snap.faceDataUrl ? this._loadFace(snap.faceDataUrl) : null,
          isHost: snap.isHost, attackCool: 0, specialCool: 0,
          invuln: 0, hitFlash: 0, dashTimer: 0,
        };
        this.players.set(snap.slot, p);
      }
      // Smooth interpolation
      p.x = snap.x; p.y = snap.y;
      p.vx = snap.vx; p.vy = snap.vy;
      p.hp = snap.hp; p.alive = snap.alive;
      p.facing = snap.facing;
      p.attackCool = snap.attackCool;
      p.specialCool = snap.specialCool;
      p.invuln = snap.invuln;
      p.hitFlash = snap.hitFlash;
    });

    // Update projectiles
    this.projectiles = msg.projectiles.map(p => ({
      id: p.id, x: p.x, y: p.y, vx: p.vx, vy: p.vy,
      kind: p.kind, ownerId: p.ownerId, life: p.life, radius: p.radius,
    }));
  }

  // ── Rendering ──

  private _render(): void {
    const { ctx } = this;
    const W = ARENA_W, H = ARENA_H;

    ctx.save();
    if (this.shake > 0) {
      ctx.translate(
        (Math.random() - 0.5) * this.shake,
        (Math.random() - 0.5) * this.shake * 0.5
      );
    }

    // Arena background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1A1A2E');
    bg.addColorStop(0.5, '#16213E');
    bg.addColorStop(1, '#0F3460');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // ── Pentagon boundary ──
    ctx.beginPath();
    PENTAGON_VERTICES.forEach((v, i) => {
      if (i === 0) ctx.moveTo(v.x, v.y);
      else ctx.lineTo(v.x, v.y);
    });
    ctx.closePath();
    // Fill pentagon area with darker shade
    ctx.fillStyle = 'rgba(15,20,40,0.5)';
    ctx.fill();
    // Pentagon border — glowing yellow
    ctx.strokeStyle = '#FDE047';
    ctx.lineWidth = 4;
    ctx.shadowColor = '#FDE047';
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // ── Pentagon corner spawn markers ──
    PENTAGON_CORNERS.forEach((c, i) => {
      ctx.strokeStyle = 'rgba(253,224,71,0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 50, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(253,224,71,0.15)';
      ctx.beginPath();
      ctx.arc(c.x, c.y, 50, 0, Math.PI * 2);
      ctx.fill();
    });

    // ── Maze walls ──
    MAZE_WALLS.forEach(wall => {
      // Wall body
      const grad = ctx.createLinearGradient(wall.x, wall.y, wall.x, wall.y + wall.h);
      grad.addColorStop(0, '#3B4D6B');
      grad.addColorStop(1, '#2A3850');
      ctx.fillStyle = grad;
      ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
      // Wall highlight
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(wall.x, wall.y, wall.w, 2);
      // Wall border
      ctx.strokeStyle = 'rgba(253,224,71,0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);
    });

    // Center decoration
    ctx.fillStyle = 'rgba(253,224,71,0.06)';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💨', W / 2, H / 2);

    // Particles (behind players)
    this.particles.draw(ctx);

    // Projectiles
    this.projectiles.forEach(p => this._drawProjectile(ctx, p));

    // Players
    this.players.forEach(p => this._drawPlayer(ctx, p));

    // Elimination feed
    this._drawElimFeed(ctx, W, H);

    // Countdown
    if (this.countdown > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#FDE047';
      ctx.font = 'bold 120px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${this.countdown}`, W / 2, H / 2);
      ctx.font = 'bold 24px Arial';
      ctx.fillStyle = '#fff';
      ctx.fillText('GET READY TO FART!', W / 2, H / 2 + 80);
    }

    // Match over
    if (this.matchOver) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);
      const winner = this.winnerSlot >= 0 ? this.players.get(this.winnerSlot) : null;
      ctx.fillStyle = '#FDE047';
      ctx.font = 'bold 56px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🏆 WINNER! 🏆', W / 2, H / 2 - 40);
      if (winner) {
        ctx.font = 'bold 32px Arial';
        ctx.fillStyle = '#fff';
        ctx.fillText(winner.name, W / 2, H / 2 + 20);
        ctx.font = '20px Arial';
        ctx.fillStyle = '#86EFAC';
        ctx.fillText(`${winner.skinId.toUpperCase()} is the GAS MASTER!`, W / 2, H / 2 + 55);
      } else {
        ctx.font = 'bold 32px Arial';
        ctx.fillStyle = '#fff';
        ctx.fillText('It\'s a draw!', W / 2, H / 2 + 20);
      }
    }

    ctx.restore();
  }

  private _drawPlayer(ctx: CanvasRenderingContext2D, p: ArenaPlayer): void {
    if (!p.alive) return;

    const skin = SKINS.find(s => s.id === p.skinId) ?? SKINS[0];

    ctx.save();
    ctx.translate(p.x, p.y);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(0, PLAYER_R * 0.8, PLAYER_R * 0.7, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hit flash
    if (p.hitFlash > 0) {
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 20;
    }

    // Invuln flicker
    if (p.invuln > 0 && Math.floor(p.invuln) % 4 < 2) {
      ctx.globalAlpha = 0.5;
    }

    // Body (suit)
    ctx.fillStyle = skin.suitColor;
    ctx.beginPath();
    ctx.roundRect(-PLAYER_R * 0.6, -PLAYER_R * 0.3, PLAYER_R * 1.2, PLAYER_R * 0.8, 10);
    ctx.fill();

    // Belt
    ctx.fillStyle = skin.beltColor;
    ctx.fillRect(-PLAYER_R * 0.55, PLAYER_R * 0.15, PLAYER_R * 1.1, 5);

    // Cape (trailing behind movement direction)
    ctx.fillStyle = skin.capeColor;
    ctx.globalAlpha *= 0.85;
    ctx.beginPath();
    ctx.ellipse(-p.facing * PLAYER_R * 0.7, 0, PLAYER_R * 0.4, PLAYER_R * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = p.invuln > 0 && Math.floor(p.invuln) % 4 < 2 ? 0.5 : 1;

    // Head (circle with skin color)
    ctx.fillStyle = skin.bodyColor;
    ctx.beginPath();
    ctx.arc(0, -PLAYER_R * 0.5, PLAYER_R * 0.55, 0, Math.PI * 2);
    ctx.fill();

    // Face — custom image or cartoon
    const faceR = PLAYER_R * 0.5;
    const faceY = -PLAYER_R * 0.5;

    if (p.faceImg && p.faceImg.complete && p.faceImg.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, faceY, faceR, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(p.faceImg, -faceR, faceY - faceR, faceR * 2, faceR * 2);
      ctx.restore();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, faceY, faceR, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // Simple cartoon eyes
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(-5 * p.facing, faceY - 3, 4, 0, Math.PI * 2);
      ctx.arc(5 * p.facing, faceY - 3, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.arc(-4 * p.facing, faceY - 3, 2, 0, Math.PI * 2);
      ctx.arc(6 * p.facing, faceY - 3, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Mask band
    ctx.fillStyle = '#DC2626';
    ctx.beginPath();
    ctx.roundRect(-PLAYER_R * 0.4, faceY - 6, PLAYER_R * 0.8, 6, 3);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    // Facing indicator (small arrow)
    ctx.fillStyle = 'rgba(253,224,71,0.4)';
    ctx.beginPath();
    ctx.moveTo(p.facing * PLAYER_R * 0.8, -PLAYER_R * 0.5);
    ctx.lineTo(p.facing * (PLAYER_R + 8), -PLAYER_R * 0.5);
    ctx.lineTo(p.facing * PLAYER_R * 0.8, -PLAYER_R * 0.3);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // ── Health bar — enlarged and clearly visible ──
    const barW = 80, barH = 10;
    const barX = p.x - barW / 2, barY = p.y - PLAYER_R - 22;

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);

    // Empty bar
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(barX, barY, barW, barH);

    // HP fill
    const hpPct = p.hp / MAX_HP;
    const hpColor = hpPct > 0.5 ? '#22C55E' : hpPct > 0.25 ? '#FBBF24' : '#EF4444';
    ctx.fillStyle = hpColor;
    ctx.fillRect(barX, barY, barW * hpPct, barH);

    // HP bar border
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);

    // HP number
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.ceil(p.hp)}`, p.x, barY + barH / 2);

    // Name
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(p.name, p.x, barY - 3);

    // Slot number
    ctx.fillStyle = '#FDE047';
    ctx.font = 'bold 9px Arial';
    ctx.fillText(`P${p.slot + 1}`, p.x, barY - 13);

    // Special cooldown ring
    if (p.specialCool > 0) {
      const cdPct = p.specialCool / SPECIAL_CD;
      ctx.strokeStyle = 'rgba(168,85,247,0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, PLAYER_R + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - cdPct));
      ctx.stroke();
    }
  }

  private _drawProjectile(ctx: CanvasRenderingContext2D, proj: Projectile): void {
    ctx.save();
    if (proj.kind === 'blast') {
      // Green fart blast
      ctx.fillStyle = '#86EFAC';
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, proj.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.arc(proj.x - 3, proj.y - 3, proj.radius * 0.4, 0, Math.PI * 2);
      ctx.fill();
      // Trail
      ctx.fillStyle = 'rgba(134,239,172,0.3)';
      ctx.beginPath();
      ctx.ellipse(proj.x - proj.vx * 2, proj.y, proj.radius * 0.8, proj.radius * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (proj.kind === 'bomb') {
      // Purple gas bomb
      const pulse = Math.sin(this.frameTime * 0.02) * 2;
      ctx.fillStyle = '#A855F7';
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, proj.radius + pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#EC4899';
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, proj.radius * 0.5, 0, Math.PI * 2);
      ctx.fill();
      // Warning ring when about to explode
      if (proj.life < 15) {
        ctx.strokeStyle = `rgba(239,68,68,${1 - proj.life / 15})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, BOMB_R * (1 - proj.life / 15), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private _drawElimFeed(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.elimFeed.forEach((e, i) => {
      ctx.globalAlpha = e.alpha;
      ctx.fillStyle = '#F87171';
      ctx.font = 'bold 16px Arial';
      ctx.fillText(e.text, W / 2, 30 + i * 24);
    });
    ctx.globalAlpha = 1;
  }

  // ── Helpers ──

  private _loadFace(dataUrl: string): HTMLImageElement {
    const img = new Image();
    img.src = dataUrl;
    return img;
  }

  get aliveCount(): number {
    return [...this.players.values()].filter(p => p.alive).length;
  }

  get isMatchOver(): boolean { return this.matchOver; }
  get countdownVal(): number { return this.countdown; }

  // Client: apply match-over from host
  applyMatchOver(winnerSlot: number): void {
    this.matchOver = true;
    this.winnerSlot = winnerSlot;
  }
}
