// ============================================================
// FART MAN — Game Engine  ★ PLATFORMER EDITION ★
//
// Inspired by Google Dino: Fart Man runs on city rooftops.
// Gaps between buildings must be crossed by farting (jumping).
// Fall into a gap → Game Over.
//
// Canvas is always drawn in LOGICAL pixels (pre-DPR).
// DPR scaling is handled once in GameCanvas via ctx.scale().
// ============================================================

import { GAME_CONFIG, SkinDef, SKINS } from '@/lib/gameConfig';
import { randInt, randFloat, clamp } from '@/lib/physics';
import { AudioManager } from './AudioManager';
import { Player } from './Player';
import { ParticleSystem } from './Particles';

export type EngineState = 'idle' | 'playing' | 'paused' | 'gameover';

export interface EngineCallbacks {
  onScoreChange:    (score: number) => void;
  onBestChange:     (best: number)  => void;
  onGasMeterChange: (fill: number)  => void;
  onBoostChange:    (active: boolean, remaining: number) => void;
  onGameOver:       (score: number) => void;
  onStateChange:    (state: EngineState) => void;
}

// ─────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────

interface Platform {
  worldX: number;   // left edge in world space
  topY:   number;   // top surface Y in logical pixels (fixed, no DPR)
  width:  number;
  kind: 'plain' | 'watertank' | 'antenna' | 'billboard' | 'helipad' | 'garden';
  color:       string;
  accentColor: string;
  windows: { wx: number; wy: number; lit: boolean }[];
  scored: boolean;
}

interface Gap {
  worldX: number;  // left edge of gap
  width:  number;
}

interface Collectible {
  worldX:    number;
  screenY:   number;
  kind:      'bean' | 'chilli' | 'gasbottle' | 'capsule';
  collected: boolean;
  bobPhase:  number;
  rotation:  number;
}

interface Cloud { x: number; y: number; w: number; speed: number; alpha: number; }
interface BgBuilding { x: number; y: number; w: number; h: number; color: string; }
interface Bird { x: number; y: number; vx: number; vy: number; wing: number; }

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

// Logical canvas dimensions (always work in these)
const CW = GAME_CONFIG.CANVAS_WIDTH;   // 480
const CH = GAME_CONFIG.CANVAS_HEIGHT;  // 720

// Where on screen the player stands (fixed X, Y set by physics)
const PLAYER_X  = GAME_CONFIG.PLAYER_SCREEN_X;  // 110
const PLAYER_W  = GAME_CONFIG.PLAYER_WIDTH;      // 52
const PLAYER_H  = GAME_CONFIG.PLAYER_HEIGHT;     // 64

// Rooftop Y range: platforms sit between 45% and 72% down the canvas
const PLAT_Y_MIN = Math.round(CH * 0.45);  // ~324
const PLAT_Y_MAX = Math.round(CH * 0.72);  // ~518

// The ground/floor that kills the player is just off the bottom
const DEATH_Y = CH + 10;

// Initial run speed (pixels per logical frame @ 60fps)
const SPEED_INITIAL = 3.0;
const SPEED_MAX     = 6.0;
const GRAVITY       = 0.6;         // pixels/frame²
const JUMP_VEL      = -12.5;       // pixels/frame (upward)
const BOOST_JUMP    = -16.0;

const BLDG_COLORS   = ['#2D3561','#1B2A4A','#1A1F3C','#0F1B35','#1E2D55','#243050','#162040'];
const ACCENT_COLORS = ['#3B82F6','#6366F1','#8B5CF6','#EC4899','#14B8A6','#F59E0B'];
const COL_KINDS     = ['bean','chilli','gasbottle','capsule'] as const;

// ─────────────────────────────────────────────

export class GameEngine {
  // Canvas / context — always draw in logical px
  private canvas: HTMLCanvasElement;
  private ctx:    CanvasRenderingContext2D;
  private W = CW;
  private H = CH;

  private callbacks: EngineCallbacks;
  private audio:     AudioManager;
  private particles: ParticleSystem;

  // State
  private state:      EngineState = 'idle';
  private score       = 0;
  private bestScore   = 0;
  private gasMeter    = 0;
  private boostActive    = false;
  private boostRemaining = 0;
  private boostFlash     = 0;
  private fartCycle      = 0;

  // Timing
  private frameId   = 0;
  private lastTime  = 0;
  private frameTime = 0;   // cumulative ms (for animations)

  // Speed
  private speed = SPEED_INITIAL;

  // Player
  private player!:  Player;
  private _skin:    SkinDef = SKINS[0];
  private _face:    HTMLImageElement | null = null;
  private playerY  = 0;     // top-left Y of player bounding box (logical)
  private velY     = 0;     // vertical velocity (logical px / frame)
  private onGround = false;

  // World
  private worldX     = 0;   // how many logical px have scrolled left
  private nextWorldX = 0;   // X where the next platform starts
  private platforms:    Platform[]   = [];
  private gaps:         Gap[]        = [];
  private collectibles: Collectible[] = [];

  // Background
  private bgBuildings: BgBuilding[] = [];
  private clouds: Cloud[] = [];
  private birds:  Bird[]  = [];
  private stars:  { x: number; y: number; r: number; a: number }[] = [];
  private lastCloudWorldX = 0;

  // Shake
  private shakeAmt = 0;

  // ─────────────────────────────────────────────
  constructor(
    canvas: HTMLCanvasElement,
    callbacks: EngineCallbacks,
    audio: AudioManager
  ) {
    this.canvas    = canvas;
    this.ctx       = canvas.getContext('2d')!;
    this.callbacks = callbacks;
    this.audio     = audio;
    this.particles = new ParticleSystem();
    this._initBackground();
    this._newPlayer();
  }

  // ─────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────

  setSkin(skin: SkinDef): void {
    this._skin = skin;
    this.player?.setSkin(skin);
  }

  setFaceImage(img: HTMLImageElement | null): void {
    this._face = img;
    this.player?.setFaceImage(img);
  }

  start(): void {
    if (this.state === 'playing') return;
    this._reset();
    this._setState('playing');
    this.audio.startGameplay();
    this.lastTime = performance.now();
    this._loop(performance.now());
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this._setState('paused');
    this.audio.pauseGameplay();
    cancelAnimationFrame(this.frameId);
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this._setState('playing');
    this.audio.resumeGameplay();
    this.lastTime = performance.now();
    this._loop(performance.now());
  }

  restart(): void {
    cancelAnimationFrame(this.frameId);
    this._reset();
    this._setState('playing');
    this.audio.startGameplay();
    this.lastTime = performance.now();
    this._loop(performance.now());
  }

  stop(): void {
    cancelAnimationFrame(this.frameId);
    this._setState('idle');
  }

  fart(): void {
    if (this.state !== 'playing') return;
    this.velY     = this.boostActive ? BOOST_JUMP : JUMP_VEL;
    this.onGround = false;
    this.player.setState('farting');
    this.audio.playFartSFX();

    // Fart particles — emit from behind the player
    const px = PLAYER_X;
    const py = this.playerY + PLAYER_H * 0.55;
    this.fartCycle++;
    if (this.boostActive) {
      this.particles.emit('fart_rainbow', px, py, 10);
      this.particles.emit('fart_turbo',   px, py, 6);
    } else {
      switch (this.fartCycle % 5) {
        case 0: this.particles.emit('fart_small',   px, py, 8); break;
        case 1: this.particles.emit('fart_big',     px, py, 5); break;
        case 2: this.particles.emit('fart_rainbow', px, py, 7); break;
        case 3: this.particles.emit('fart_ring',    px, py, 8); break;
        case 4: this.particles.emit('fart_turbo',   px, py, 6); break;
      }
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.frameId);
    this.particles.clear();
  }

  // ─────────────────────────────────────────────
  // Private: init & reset
  // ─────────────────────────────────────────────

  private _newPlayer(): void {
    this.player = new Player(this._skin);
    this.player.setFaceImage(this._face);
  }

  private _reset(): void {
    // Reset counters
    this.score          = 0;
    this.gasMeter       = 0;
    this.boostActive    = false;
    this.boostRemaining = 0;
    this.boostFlash     = 0;
    this.fartCycle      = 0;
    this.worldX         = 0;
    this.nextWorldX     = 0;
    this.speed          = SPEED_INITIAL;
    this.shakeAmt       = 0;
    this.frameTime      = 0;

    // Rebuild player (keeps face + skin)
    this._newPlayer();

    // Clear world objects
    this.platforms    = [];
    this.gaps         = [];
    this.collectibles = [];
    this.particles.clear();

    // ── Seed platforms ──
    // First platform: starts at screen X=0, wide and safe, fixed height
    const FIRST_Y = Math.round(CH * 0.62);  // 446px — comfortable mid-height
    this._addPlatform(0, 320, FIRST_Y, 'helipad');

    // Pre-generate enough platforms to fill more than two screen widths
    for (let i = 0; i < 10; i++) this._spawnNextPlatform();

    // ── Place player on the first platform ──
    this.playerY  = FIRST_Y - PLAYER_H;   // feet sit exactly on top surface
    this.velY     = 0;
    this.onGround = true;

    // ── Sync player object ──
    this.player.x = PLAYER_X;
    this.player.y = this.playerY;
    this.player.setState('idle');

    // ── Notify UI ──
    this.callbacks.onScoreChange(0);
    this.callbacks.onGasMeterChange(0);
    this.callbacks.onBoostChange(false, 0);
  }

  // Add a platform directly (used for the first platform)
  private _addPlatform(worldX: number, width: number, topY: number, kind: Platform['kind']): void {
    const color  = BLDG_COLORS[randInt(0, BLDG_COLORS.length - 1)];
    const accent = ACCENT_COLORS[randInt(0, ACCENT_COLORS.length - 1)];
    const buildH = CH - topY;
    const windows: Platform['windows'] = [];
    for (let wy = 10; wy < buildH - 20; wy += 22) {
      for (let wx = 8; wx < width - 18; wx += 18) {
        windows.push({ wx, wy, lit: Math.random() > 0.4 });
      }
    }
    this.platforms.push({ worldX, topY, width, kind, color, accentColor: accent, windows, scored: false });
    this.nextWorldX = worldX + width;
  }

  // Spawn the next platform after a gap
  private _spawnNextPlatform(): void {
    // Gap between previous platform and this one
    const minGap   = GAME_CONFIG.GAP_MIN_WIDTH;
    const maxGap   = Math.min(GAME_CONFIG.GAP_MAX_WIDTH, minGap + this.score * 4);
    const gapWidth = randInt(minGap, maxGap);

    // Record gap
    this.gaps.push({ worldX: this.nextWorldX, width: gapWidth });

    // Platform width
    const platW = randInt(GAME_CONFIG.PLATFORM_MIN_WIDTH, GAME_CONFIG.PLATFORM_MAX_WIDTH);

    // Platform height: vary from previous, but stay within range
    const prevY   = this.platforms.length
      ? this.platforms[this.platforms.length - 1].topY
      : Math.round(CH * 0.62);
    const maxDelta = GAME_CONFIG.PLATFORM_Y_CHANGE_MAX;
    const newY     = clamp(
      prevY + randInt(-maxDelta, maxDelta),
      PLAT_Y_MIN, PLAT_Y_MAX
    );

    const kinds = ['plain','watertank','antenna','billboard','helipad','garden'] as Platform['kind'][];
    const kind  = kinds[randInt(0, kinds.length - 1)];

    const platWorldX = this.nextWorldX + gapWidth;
    this._addPlatform(platWorldX, platW, newY, kind);

    // Maybe spawn a collectible floating above this platform
    if (Math.random() < GAME_CONFIG.COLLECTIBLE_SPAWN_CHANCE) {
      this.collectibles.push({
        worldX:   platWorldX + platW / 2,
        screenY:  newY - 44,          // floats above rooftop
        kind:     COL_KINDS[randInt(0, COL_KINDS.length - 1)],
        collected: false,
        bobPhase:  randFloat(0, Math.PI * 2),
        rotation:  0,
      });
    }
  }

  // ─────────────────────────────────────────────
  // Private: game loop
  // ─────────────────────────────────────────────

  private _loop(ts: number): void {
    const rawDt = Math.min(ts - this.lastTime, 50);
    this.lastTime   = ts;
    this.frameTime += rawDt;

    this._update(rawDt);
    this._render();

    if (this.state === 'playing') {
      this.frameId = requestAnimationFrame((t) => this._loop(t));
    }
  }

  // ─────────────────────────────────────────────
  // Private: update
  // ─────────────────────────────────────────────

  private _update(dt: number): void {
    if (this.state !== 'playing') return;

    // Normalise dt to 60fps frames so speeds feel consistent
    const frames = dt / 16.667;

    // ── Speed increases with score ──
    this.speed = Math.min(SPEED_MAX, SPEED_INITIAL + this.score * 0.04);

    // ── Scroll world ──
    this.worldX += this.speed * frames;

    // ── Gravity ──
    const grav = this.boostActive ? GRAVITY * 0.65 : GRAVITY;
    this.velY += grav * frames;
    this.velY  = Math.min(this.velY, 18);  // terminal velocity

    // ── Apply vertical movement ──
    this.playerY += this.velY * frames;

    // ── Platform collision ──
    this.onGround = false;
    const pLeft  = PLAYER_X + 6;
    const pRight = PLAYER_X + PLAYER_W - 6;
    const pFeet  = this.playerY + PLAYER_H;

    for (const plat of this.platforms) {
      const sx = plat.worldX - this.worldX;  // screen X
      const sr = sx + plat.width;             // screen right

      // Horizontal overlap
      if (pRight <= sx || pLeft >= sr) continue;

      // Landing detection: feet cross the top surface going downward
      const prevFeet = pFeet - this.velY * frames;
      if (prevFeet <= plat.topY + 2 && pFeet >= plat.topY && this.velY >= 0) {
        this.playerY  = plat.topY - PLAYER_H;
        this.velY     = 0;
        this.onGround = true;

        // Score when player passes this platform
        if (!plat.scored) {
          plat.scored = true;
          this.score++;
          if (this.score > this.bestScore) {
            this.bestScore = this.score;
            this.callbacks.onBestChange(this.bestScore);
          }
          this.callbacks.onScoreChange(this.score);
          this.particles.emit('score_pop', PLAYER_X + PLAYER_W + 10, this.playerY, 1);
        }
        break;
      }
    }

    // ── Sync player draw position ──
    this.player.x = PLAYER_X;
    this.player.y = this.playerY;
    this.player.velocityY = this.velY;

    // ── Animation state ──
    if (this.onGround) {
      this.player.setState('running');
    } else if (this.velY < -1) {
      this.player.setState('flying');
    } else {
      this.player.setState('falling');
    }
    this.player.update(dt);

    // ── Death: fell below canvas ──
    if (this.playerY > DEATH_Y) {
      this._gameOver();
      return;
    }

    // ── Collectibles ──
    for (const col of this.collectibles) {
      if (col.collected) continue;
      col.rotation += 0.04 * frames;
      const cx = col.worldX - this.worldX;
      const cy = col.screenY + Math.sin(this.frameTime * 0.005 + col.bobPhase) * 5;
      const px = PLAYER_X + PLAYER_W / 2;
      const py = this.playerY + PLAYER_H / 2;
      if (Math.hypot(px - cx, py - cy) < 28) {
        col.collected = true;
        const pts = { bean:5, chilli:8, gasbottle:10, capsule:6 }[col.kind];
        const gas = { bean:15, chilli:25, gasbottle:40, capsule:20 }[col.kind];
        this.score += pts;
        if (this.score > this.bestScore) { this.bestScore = this.score; this.callbacks.onBestChange(this.bestScore); }
        this.callbacks.onScoreChange(this.score);
        this.gasMeter = Math.min(GAME_CONFIG.GAS_METER_MAX, this.gasMeter + gas);
        this.callbacks.onGasMeterChange(this.gasMeter);
        this.particles.emit('collectible_sparkle', cx, cy, 12);
        this.particles.emit('score_pop', cx, cy - 20, 1);
        if (this.gasMeter >= GAME_CONFIG.GAS_METER_MAX && !this.boostActive) this._activateBoost();
      }
    }

    // ── Boost countdown ──
    if (this.boostActive) {
      this.boostRemaining -= dt;
      if (this.boostRemaining <= 0) { this.boostActive = false; this.boostRemaining = 0; }
      this.callbacks.onBoostChange(this.boostActive, Math.max(0, this.boostRemaining));
    }
    if (this.boostFlash > 0) this.boostFlash -= 0.04 * frames;

    // ── Particles ──
    this.particles.update(dt);

    // ── Shake decay ──
    if (this.shakeAmt > 0) this.shakeAmt = Math.max(0, this.shakeAmt - 0.8 * frames);

    // ── Spawn more platforms ──
    while (this.nextWorldX - this.worldX < CW + 400) {
      this._spawnNextPlatform();
    }

    // ── Prune off-screen objects ──
    const cullX = this.worldX - 300;
    this.platforms    = this.platforms.filter(p => p.worldX + p.width > cullX);
    this.gaps         = this.gaps.filter(g => g.worldX + g.width > cullX);
    this.collectibles = this.collectibles.filter(c => c.worldX > cullX);

    // ── Background animation ──
    this._updateBirds(frames);

    // Window flicker
    if (this.frameTime % 2200 < dt) {
      const p = this.platforms[randInt(0, Math.min(5, this.platforms.length - 1))];
      if (p?.windows.length) {
        const w = p.windows[randInt(0, p.windows.length - 1)];
        w.lit = !w.lit;
      }
    }
  }

  // ─────────────────────────────────────────────
  // Private: boost & game over
  // ─────────────────────────────────────────────

  private _activateBoost(): void {
    this.boostActive    = true;
    this.boostRemaining = GAME_CONFIG.GAS_BOOST_DURATION;
    this.gasMeter       = 0;
    this.boostFlash     = 1;
    this.callbacks.onGasMeterChange(0);
    this.callbacks.onBoostChange(true, GAME_CONFIG.GAS_BOOST_DURATION);
    this.particles.emit('boost_burst', PLAYER_X + PLAYER_W / 2, this.playerY + PLAYER_H / 2, 24);
  }

  private _gameOver(): void {
    if (this.state === 'gameover') return;
    this.player.setState('collision');
    this.particles.emit('crash_star', PLAYER_X + PLAYER_W / 2, this.playerY + PLAYER_H / 2, 14);
    this.shakeAmt = 16;
    this._setState('gameover');
    this.audio.playGameOver();
    this.callbacks.onGameOver(this.score);
    cancelAnimationFrame(this.frameId);
    this._render();  // draw one last frame showing crash
  }

  private _setState(s: EngineState): void {
    this.state = s;
    this.callbacks.onStateChange(s);
  }

  // ─────────────────────────────────────────────
  // Private: background init
  // ─────────────────────────────────────────────

  private _initBackground(): void {
    // Stars
    for (let i = 0; i < 80; i++) {
      this.stars.push({
        x: randFloat(0, CW), y: randFloat(0, CH * 0.6),
        r: randFloat(0.5, 2.2), a: randFloat(0.3, 1),
      });
    }

    // Far silhouette buildings (parallax layer)
    const silCols = ['#0D1B2A','#0E1F35','#0A1628','#0B1A30'];
    for (let i = 0; i < 22; i++) {
      const w = randInt(30, 72);
      const h = randInt(80, 280);
      this.bgBuildings.push({
        x: i * 50 + randInt(0, 20),
        y: CH - h, w, h,
        color: silCols[randInt(0, silCols.length - 1)],
      });
    }

    // Clouds
    for (let i = 0; i < 8; i++) {
      this.clouds.push({
        x: randFloat(0, CW), y: randFloat(30, 200),
        w: randFloat(60, 140),
        speed: randFloat(0.4, 1.2), alpha: randFloat(0.35, 0.75),
      });
    }

    // Birds
    for (let i = 0; i < 5; i++) {
      this.birds.push({
        x: randFloat(0, CW), y: randFloat(60, 210),
        vx: randFloat(0.3, 1.0) * (Math.random() > 0.5 ? 1 : -1),
        vy: randFloat(-0.06, 0.06), wing: randFloat(0, Math.PI * 2),
      });
    }
  }

  private _updateBirds(frames: number): void {
    for (const b of this.birds) {
      b.x    += b.vx * frames;
      b.y    += b.vy * frames;
      b.wing += 0.1 * frames;
      if (b.x > CW + 50) b.x = -50;
      if (b.x < -50)     b.x = CW + 50;
      if (b.y < 30 || b.y > 220) b.vy = -b.vy;
    }
  }

  // ─────────────────────────────────────────────
  // Private: rendering
  // All coordinates here are LOGICAL pixels.
  // ctx is already scaled by DPR in GameCanvas.
  // ─────────────────────────────────────────────

  private _render(): void {
    const { ctx } = this;
    const W = CW, H = CH;

    ctx.save();

    // Screen shake
    if (this.shakeAmt > 0) {
      ctx.translate(
        (Math.random() - 0.5) * this.shakeAmt,
        (Math.random() - 0.5) * this.shakeAmt * 0.4
      );
    }

    // ── 1. Sky gradient ──
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0,    '#0B0F28');
    sky.addColorStop(0.45, '#0F2055');
    sky.addColorStop(0.75, '#1B4080');
    sky.addColorStop(1,    '#2563EB');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // ── 2. Stars ──
    this._renderStars(ctx);

    // ── 3. Far buildings (parallax, no gaps) ──
    this._renderBgBuildings(ctx, W, H);

    // ── 4. Clouds ──
    this._renderClouds(ctx, W);

    // ── 5. Birds ──
    this._renderBirds(ctx);

    // ── 6. Foreground buildings (platforms) ──
    //    Draw sky-coloured fill between platforms first so gaps
    //    show the sky, NOT a black rectangle
    this._renderPlatforms(ctx, W, H);

    // ── 7. Collectibles ──
    this._renderCollectibles(ctx, W);

    // ── 8. Boost flash ──
    if (this.boostFlash > 0) {
      ctx.fillStyle = `rgba(168,85,247,${this.boostFlash * 0.22})`;
      ctx.fillRect(0, 0, W, H);
    }

    // ── 9. Particles ──
    this.particles.draw(ctx);

    // ── 10. Player ──
    this.player.draw(ctx);

    ctx.restore();
  }

  // ── Stars ──
  private _renderStars(ctx: CanvasRenderingContext2D): void {
    for (const s of this.stars) {
      const t = 0.55 + 0.45 * Math.sin(this.frameTime * 0.0015 + s.x * 0.1);
      ctx.globalAlpha = s.a * t;
      ctx.fillStyle   = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ── Far silhouette buildings (scroll slowly) ──
  private _renderBgBuildings(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const offset = ((this.worldX * 0.12) % W + W) % W;
    ctx.save();
    ctx.translate(-offset, 0);
    for (let rep = 0; rep < 3; rep++) {
      for (const b of this.bgBuildings) {
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x + rep * W, b.y, b.w, b.h);
      }
    }
    ctx.restore();
  }

  // ── Clouds ──
  private _renderClouds(ctx: CanvasRenderingContext2D, W: number): void {
    const dx = (this.worldX - this.lastCloudWorldX) * 0.15;
    this.lastCloudWorldX = this.worldX;
    for (const c of this.clouds) {
      c.x -= dx * c.speed;
      if (c.x < -c.w * 2) c.x = W + c.w;
      ctx.globalAlpha = c.alpha;
      ctx.fillStyle   = '#ffffff';
      this._cloudBlob(ctx, c.x, c.y, c.w);
      ctx.globalAlpha = 1;
    }
  }

  private _cloudBlob(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
    ctx.beginPath();
    ctx.arc(x,            y,          w * 0.27, 0, Math.PI * 2);
    ctx.arc(x + w * 0.26, y - w*0.09, w * 0.21, 0, Math.PI * 2);
    ctx.arc(x + w * 0.52, y,          w * 0.25, 0, Math.PI * 2);
    ctx.arc(x + w * 0.72, y + w*0.04, w * 0.17, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Birds ──
  private _renderBirds(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = 'rgba(200,220,255,0.55)';
    ctx.lineWidth   = 1.5;
    for (const b of this.birds) {
      const flap = Math.sin(b.wing) * 5;
      ctx.beginPath();
      ctx.moveTo(b.x - 8, b.y + flap);
      ctx.quadraticCurveTo(b.x, b.y - 3, b.x + 8, b.y + flap);
      ctx.stroke();
    }
  }

  // ── Platforms (buildings) ──
  private _renderPlatforms(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    for (const plat of this.platforms) {
      const sx = plat.worldX - this.worldX;
      if (sx + plat.width < -10 || sx > W + 10) continue;
      this._renderBuilding(ctx, plat, sx, H);
    }
  }

  private _renderBuilding(ctx: CanvasRenderingContext2D, plat: Platform, sx: number, H: number): void {
    const { topY, width: w, color, accentColor, windows, kind } = plat;
    const buildH = H - topY;

    // ── Building body ──
    const grad = ctx.createLinearGradient(sx, topY, sx + w, topY);
    grad.addColorStop(0,   color);
    grad.addColorStop(0.5, this._lighten(color, 18));
    grad.addColorStop(1,   color);
    ctx.fillStyle = grad;
    ctx.fillRect(sx, topY, w, buildH);

    // Left accent stripe
    ctx.fillStyle = accentColor;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(sx, topY, 4, buildH);
    ctx.globalAlpha = 1;

    // Windows
    for (const win of windows) {
      if (win.lit) {
        ctx.fillStyle = '#FDE68A';
        ctx.fillRect(sx + win.wx, topY + win.wy, 10, 13);
        // Soft glow
        ctx.fillStyle = 'rgba(253,230,138,0.12)';
        ctx.fillRect(sx + win.wx - 2, topY + win.wy - 2, 14, 17);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(sx + win.wx, topY + win.wy, 10, 13);
      }
    }

    // ── Rooftop ledge ──
    ctx.fillStyle = '#4B5563';
    ctx.fillRect(sx, topY - 5, w, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(sx, topY - 5, w, 2);

    // ── Rooftop decoration ──
    this._renderRoofDeco(ctx, plat, sx);
  }

  private _renderRoofDeco(ctx: CanvasRenderingContext2D, plat: Platform, sx: number): void {
    const { topY, width: w, kind, accentColor } = plat;
    const cx = sx + w / 2;
    const ty = topY - 5;   // top of ledge

    switch (kind) {
      case 'watertank': {
        ctx.fillStyle = '#94A3B8';
        ctx.beginPath(); ctx.ellipse(cx, ty - 22, 16, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#64748B';
        ctx.fillRect(cx - 16, ty - 22, 32, 20);
        ctx.fillStyle = '#94A3B8';
        ctx.beginPath(); ctx.ellipse(cx, ty - 2, 16, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#475569'; ctx.lineWidth = 2.5;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath(); ctx.moveTo(cx + i*12, ty - 2); ctx.lineTo(cx + i*14, ty + 6); ctx.stroke();
        }
        break;
      }
      case 'antenna': {
        ctx.strokeStyle = '#9CA3AF'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(cx, ty); ctx.lineTo(cx, ty - 40); ctx.stroke();
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx - 11, ty - 28); ctx.lineTo(cx + 11, ty - 28); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 7,  ty - 36); ctx.lineTo(cx + 7,  ty - 36); ctx.stroke();
        const blink = Math.sin(this.frameTime * 0.012) > 0;
        ctx.fillStyle = blink ? '#F87171' : '#7F1D1D';
        ctx.beginPath(); ctx.arc(cx, ty - 42, 4, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'billboard': {
        const bh = 34, bw2 = Math.max(40, w - 24);
        ctx.fillStyle = '#0F172A';
        ctx.fillRect(cx - bw2/2, ty - bh - 8, bw2, bh);
        ctx.fillStyle = accentColor;
        ctx.fillRect(cx - bw2/2, ty - bh - 8, bw2, 4);
        ctx.fillStyle = '#FDE047';
        ctx.font = `bold ${Math.min(12, bw2 / 7)}px Arial`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('💨 FART MAN!', cx, ty - bh/2 - 8);
        ctx.fillStyle = '#475569';
        ctx.fillRect(cx - 5, ty - 8, 4, 10);
        ctx.fillRect(cx + 2, ty - 8, 4, 10);
        break;
      }
      case 'helipad': {
        ctx.strokeStyle = '#FBBF24'; ctx.lineWidth = 2;
        ctx.strokeRect(cx - 22, ty - 4, 44, 6);
        ctx.fillStyle = '#FBBF24';
        ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('H', cx, ty - 1);
        break;
      }
      case 'garden': {
        const count = Math.floor(w / 30);
        for (let i = 0; i < count; i++) {
          const bx = sx + 10 + i * 30;
          ctx.fillStyle = '#16A34A';
          ctx.beginPath(); ctx.arc(bx, ty - 9, 10, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#15803D';
          ctx.beginPath(); ctx.arc(bx + 7, ty - 11, 8, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      default: {
        // Plain: subtle parapet
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(sx, ty - 3, w, 2);
      }
    }
  }

  // ── Collectibles ──
  private _renderCollectibles(ctx: CanvasRenderingContext2D, W: number): void {
    for (const col of this.collectibles) {
      if (col.collected) continue;
      const sx = col.worldX - this.worldX;
      if (sx < -40 || sx > W + 40) continue;
      const bob = Math.sin(this.frameTime * 0.005 + col.bobPhase) * 5;
      this._drawCollectible(ctx, col.kind, sx, col.screenY + bob, col.rotation);
    }
  }

  private _drawCollectible(
    ctx: CanvasRenderingContext2D,
    kind: Collectible['kind'],
    x: number, y: number, rot: number
  ): void {
    const r = 14;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);

    const glows: Record<Collectible['kind'], string> = {
      bean: 'rgba(251,191,36,0.4)', chilli: 'rgba(239,68,68,0.4)',
      gasbottle: 'rgba(96,165,250,0.4)', capsule: 'rgba(168,85,247,0.4)',
    };
    const grd = ctx.createRadialGradient(0,0,0, 0,0,r+10);
    grd.addColorStop(0, glows[kind]);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(0,0,r+10,0,Math.PI*2); ctx.fill();

    switch (kind) {
      case 'bean':
        ctx.fillStyle='#FBBF24'; ctx.strokeStyle='#D97706'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.ellipse(0,0,r,r-4,0.3,0,Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.fillStyle='#FDE68A'; ctx.font=`bold ${r}px Arial`;
        ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('✦',0,1);
        break;
      case 'chilli':
        ctx.fillStyle='#EF4444';
        ctx.beginPath(); ctx.ellipse(0,2,r-2,r,-0.3,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#16A34A';
        ctx.beginPath(); ctx.ellipse(2,-r+3,4,6,0.5,0,Math.PI*2); ctx.fill();
        break;
      case 'gasbottle':
        ctx.fillStyle='#60A5FA';
        ctx.beginPath(); ctx.roundRect(-r+2,-r,(r-2)*2,r*2-4,8); ctx.fill();
        ctx.fillStyle='#2563EB';
        ctx.beginPath(); ctx.roundRect(-5,-r,10,8,[4,4,0,0]); ctx.fill();
        ctx.fillStyle='#DBEAFE'; ctx.font=`${r-4}px Arial`;
        ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('💨',0,2);
        break;
      case 'capsule':
        ctx.fillStyle='#A855F7';
        ctx.beginPath(); ctx.roundRect(-r,-(r-2),r,(r-2)*2,[r,0,0,r]); ctx.fill();
        ctx.fillStyle='#EC4899';
        ctx.beginPath(); ctx.roundRect(0,-(r-2),r,(r-2)*2,[0,r,r,0]); ctx.fill();
        ctx.strokeStyle='#fff'; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.moveTo(0,-(r-2)); ctx.lineTo(0,r-2); ctx.stroke();
        break;
    }
    ctx.restore();
  }

  // ── Utility ──
  private _lighten(hex: string, amount: number): string {
    try {
      const n = parseInt(hex.replace('#',''), 16);
      const r = Math.min(255, (n >> 16)        + amount);
      const g = Math.min(255, ((n >> 8) & 0xff) + amount);
      const b = Math.min(255, (n & 0xff)        + amount);
      return `rgb(${r},${g},${b})`;
    } catch { return hex; }
  }
}
