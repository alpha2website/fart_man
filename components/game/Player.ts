// ============================================================
// FART MAN — Player  (Platformer Edition)
// ============================================================

import { GAME_CONFIG, SkinDef, SKINS } from '@/lib/gameConfig';
import { clamp, lerp, randFloat } from '@/lib/physics';

export type PlayerState = 'idle' | 'running' | 'flying' | 'farting' | 'falling' | 'collision' | 'victory';

export class Player {
  /** Screen-space X (fixed) */
  x: number = GAME_CONFIG.PLAYER_SCREEN_X;
  /** Screen-space Y (set by engine each frame) */
  y: number = GAME_CONFIG.CANVAS_HEIGHT * 0.5;

  velocityY = 0;
  state: PlayerState = 'idle';
  skin: SkinDef;

  /** Custom uploaded face — persisted externally by engine */
  faceImage: HTMLImageElement | null = null;

  // ---- Animation internals ----
  private frameTime    = 0;
  private blinkTimer   = 0;
  private blinkOpen    = true;
  private tiltAngle    = 0;
  private cheekyInflate = 0;   // 0..1
  private crashAngle   = 0;
  private crashSpin    = 0;
  private victoryBounce = 0;
  private capeWave     = 0;
  private bodyBob      = 0;
  private runCycle     = 0;    // leg animation cycle

  constructor(skin?: SkinDef) {
    this.skin = skin ?? SKINS[0];
  }

  setSkin(skin: SkinDef): void {
    this.skin = skin;
  }

  setFaceImage(img: HTMLImageElement | null): void {
    this.faceImage = img;
  }

  setState(s: PlayerState): void {
    this.state = s;
    if (s === 'farting') this.cheekyInflate = 1;
    if (s === 'collision') this.crashSpin   = 0;
  }

  update(deltaTime: number): void {
    this.frameTime += deltaTime;
    const dt = deltaTime / 16.67;

    // Blink
    this.blinkTimer += deltaTime;
    if (this.blinkTimer > 2800 + Math.random() * 1800) {
      this.blinkOpen  = false;
      this.blinkTimer = 0;
    }
    if (!this.blinkOpen && this.blinkTimer > 140) this.blinkOpen = true;

    // Tilt (vertical velocity → body lean)
    const targetTilt = this.state === 'running'
      ? 0
      : clamp(this.velocityY * 3.5, -30, 50);
    this.tiltAngle = lerp(this.tiltAngle, targetTilt, 0.15 * dt);

    // Cheek deflate
    if (this.cheekyInflate > 0) {
      this.cheekyInflate -= 0.055 * dt;
      if (this.cheekyInflate < 0) this.cheekyInflate = 0;
    }

    // Cape wave
    this.capeWave = Math.sin(this.frameTime * 0.007) * 7;

    // Body bob (idle/running)
    if (this.state === 'running' || this.state === 'idle') {
      this.bodyBob  = Math.sin(this.frameTime * 0.012) * 2.5;
      this.runCycle = this.frameTime * 0.022;
    }

    // Crash spin
    if (this.state === 'collision') {
      this.crashSpin  += 9 * dt;
      this.crashAngle  = this.crashSpin;
    }

    // Victory bounce
    if (this.state === 'victory') {
      this.victoryBounce = Math.abs(Math.sin(this.frameTime * 0.009)) * 14;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const { skin } = this;

    // Centre of bounding box
    const cx = this.x + GAME_CONFIG.PLAYER_WIDTH  / 2;
    const cy = this.y + GAME_CONFIG.PLAYER_HEIGHT / 2
      + (this.state === 'idle' || this.state === 'running' ? this.bodyBob : 0);

    ctx.save();
    ctx.translate(cx, cy);

    let angle = (this.tiltAngle * Math.PI) / 180;
    if (this.state === 'collision') angle = (this.crashAngle * Math.PI) / 180;
    if (this.state === 'victory')   ctx.translate(0, -this.victoryBounce);
    ctx.rotate(angle);

    // Atomic glow
    if (skin.glowColor) {
      ctx.shadowColor = skin.glowColor;
      ctx.shadowBlur  = 20;
    }

    this._drawBody(ctx, skin);
    this._drawFace(ctx, skin);
    this._drawCape(ctx, skin);
    this._drawBelt(ctx, skin);
    this._drawBoots(ctx, skin);
    this._drawMask(ctx);

    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // ==============================================================
  // Body
  // ==============================================================

  private _drawBody(ctx: CanvasRenderingContext2D, skin: SkinDef): void {
    const W  = GAME_CONFIG.PLAYER_WIDTH;
    const H  = GAME_CONFIG.PLAYER_HEIGHT;
    const bx = -W / 2;

    // Torso
    ctx.fillStyle = skin.suitColor;
    ctx.beginPath();
    ctx.roundRect(bx + 6, -4, W - 12, H / 2 - 2, 10);
    ctx.fill();

    // Chest emblem (💨)
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.arc(0, 6, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💨', 0, 6);

    // Head — enlarged to fit bigger custom faces
    const headInflate = this.cheekyInflate * 3;
    const hBase = -H / 4 - 4;
    const headR = this.faceImage ? 28 : 22;   // bigger head when custom face is active
    ctx.fillStyle = skin.bodyColor;
    ctx.beginPath();
    ctx.ellipse(0, hBase + headInflate * 0.5, headR + headInflate, headR + headInflate, 0, 0, Math.PI * 2);
    ctx.fill();

    // Arms — swing when running
    ctx.fillStyle = skin.suitColor;
    const armSwing = this.state === 'running' ? Math.sin(this.runCycle) * 10 : 0;
    ctx.beginPath(); ctx.roundRect(bx + 1,     2 + armSwing, 9, 20, 4); ctx.fill();
    ctx.beginPath(); ctx.roundRect(bx + W - 10, 2 - armSwing, 9, 20, 4); ctx.fill();

    // Legs — running animation
    const legSwing  = this.state === 'running' ? Math.sin(this.runCycle) * 14 : 0;
    const legSwing2 = this.state === 'running' ? Math.sin(this.runCycle + Math.PI) * 14 : 0;
    ctx.fillStyle = skin.suitColor;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(bx + 8,      H / 2 - 8 + legSwing,  12, 20, 5); ctx.fill();
    ctx.beginPath();
    ctx.roundRect(bx + W - 20, H / 2 - 8 + legSwing2, 12, 20, 5); ctx.fill();
    ctx.restore();

    // Cheek puffs
    if (this.cheekyInflate > 0.1) {
      const alpha = this.cheekyInflate * 0.4;
      ctx.fillStyle = `rgba(255,140,90,${alpha})`;
      ctx.beginPath();
      ctx.ellipse(-14 - this.cheekyInflate * 3, hBase + 2, 8 + this.cheekyInflate * 4, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse( 14 + this.cheekyInflate * 3, hBase + 2, 8 + this.cheekyInflate * 4, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ==============================================================
  // Face — draws custom image OR cartoon face
  // ==============================================================

  private _drawFace(ctx: CanvasRenderingContext2D, skin: SkinDef): void {
    const H     = GAME_CONFIG.PLAYER_HEIGHT;
    const hBase = -H / 4 - 4;
    // Bigger face circle so uploaded photos are clearly visible (especially on mobile)
    const faceR = 26;

    if (this.faceImage && this.faceImage.complete && this.faceImage.naturalWidth > 0) {
      // ---- Custom uploaded face — large and clearly visible ----
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, hBase, faceR, 0, Math.PI * 2);
      ctx.clip();
      // Draw the uploaded face filling the entire circle, centred
      ctx.drawImage(
        this.faceImage,
        -faceR,            // dest x — centred
        hBase - faceR,     // dest y — centred on head
        faceR * 2,         // dest width
        faceR * 2          // dest height
      );
      ctx.restore();

      // Draw a thin border ring around the face so it blends with the cartoon
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, hBase, faceR, 0, Math.PI * 2);
      ctx.stroke();

      // Highlight on top-left for a cartoon look
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.ellipse(-faceR * 0.35, hBase - faceR * 0.35, faceR * 0.4, faceR * 0.25, -0.5, 0, Math.PI * 2);
      ctx.fill();

      // Draw the mask band across the eyes area on top of the photo
      this._drawMask(ctx);
      return;
    }

    // ---- Default cartoon face ----
    const isCollision = this.state === 'collision';
    const isFarting   = this.cheekyInflate > 0.3;
    const isFalling   = this.state === 'falling';
    const eyeY        = hBase - 4;

    if (this.blinkOpen && !isCollision) {
      // Eyes open
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(-7, eyeY, 5, isFarting ? 6 : 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse( 7, eyeY, 5, isFarting ? 6 : 5, 0, 0, Math.PI * 2); ctx.fill();
      // Pupils
      ctx.fillStyle = '#1a1a1a';
      const pOff = isFalling ? 2 : 0;
      ctx.beginPath(); ctx.ellipse(-6.5, eyeY + pOff + 1, 2.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse( 7.5, eyeY + pOff + 1, 2.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      // Shine
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(-5, eyeY - 1, 1.2, 1.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse( 9, eyeY - 1, 1.2, 1.2, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      // Closed / squinting
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(-7, eyeY, 4, Math.PI, 0, isCollision); ctx.stroke();
      ctx.beginPath(); ctx.arc( 7, eyeY, 4, Math.PI, 0, isCollision); ctx.stroke();
    }

    // Eyebrows
    ctx.strokeStyle = '#5D3A1A'; ctx.lineWidth = 2;
    if (isFalling || isCollision) {
      ctx.beginPath(); ctx.moveTo(-12, eyeY - 8); ctx.quadraticCurveTo(-7, eyeY - 12, -2, eyeY - 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(  2, eyeY - 7); ctx.quadraticCurveTo( 7, eyeY - 12, 12, eyeY - 8); ctx.stroke();
    } else if (isFarting) {
      ctx.beginPath(); ctx.moveTo(-12, eyeY - 9); ctx.lineTo(-2, eyeY - 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(  2, eyeY - 7); ctx.lineTo(12, eyeY - 9); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(-12, eyeY - 8); ctx.lineTo(-2, eyeY - 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(  2, eyeY - 8); ctx.lineTo(12, eyeY - 8); ctx.stroke();
    }

    // Mouth
    const mouthY = hBase + 8;
    ctx.strokeStyle = '#5D3A1A'; ctx.lineWidth = 2;
    if (isCollision) {
      ctx.fillStyle = '#5D3A1A';
      ctx.beginPath(); ctx.ellipse(0, mouthY, 5, 6, 0, 0, Math.PI * 2); ctx.fill();
    } else if (isFarting) {
      ctx.beginPath(); ctx.moveTo(-7, mouthY + 2); ctx.lineTo(7, mouthY + 2); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(0, mouthY, 6, 0, Math.PI); ctx.stroke();
    }

    // Skin-specific extras
    if (skin.id === 'grandpa') {
      ctx.fillStyle = '#D1D5DB';
      ctx.beginPath(); ctx.ellipse(-4, mouthY - 1, 5, 3, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse( 4, mouthY - 1, 5, 3,  0.3, 0, Math.PI * 2); ctx.fill();
    }
    if (skin.id === 'baby') {
      ctx.fillStyle = '#F87171';
      ctx.beginPath(); ctx.ellipse(0, mouthY + 3, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#FBBF24';
      ctx.beginPath(); ctx.ellipse(0, mouthY + 5, 7, 2, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (skin.id === 'businessman') {
      ctx.fillStyle = '#DC2626';
      ctx.beginPath();
      ctx.moveTo(-3, hBase + 14); ctx.lineTo(3, hBase + 14);
      ctx.lineTo(5, hBase + 24); ctx.lineTo(0, hBase + 30);
      ctx.lineTo(-5, hBase + 24); ctx.closePath(); ctx.fill();
    }
    if (skin.id === 'atomic') {
      ctx.strokeStyle = '#FDE047'; ctx.lineWidth = 1.5;
      const rx = 0, ry = hBase + 12;
      ctx.beginPath(); ctx.arc(rx, ry, 8, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(rx + Math.cos(a) * 3, ry + Math.sin(a) * 3);
        ctx.lineTo(rx + Math.cos(a) * 7, ry + Math.sin(a) * 7);
        ctx.stroke();
      }
    }
  }

  // ==============================================================
  // Cape, Belt, Boots, Mask
  // ==============================================================

  private _drawCape(ctx: CanvasRenderingContext2D, skin: SkinDef): void {
    const bx   = GAME_CONFIG.PLAYER_WIDTH / 2 - 2;
    const wave = this.capeWave;
    ctx.fillStyle = skin.capeColor;
    ctx.beginPath();
    ctx.moveTo(bx - 12, -8);
    ctx.quadraticCurveTo(bx + 14, -4 + wave * 0.3, bx + 26, 8 + wave);
    ctx.quadraticCurveTo(bx + 20, 20 + wave * 0.5, bx + 10, 26 + wave * 0.8);
    ctx.quadraticCurveTo(bx - 2,  28, bx - 12, 16);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.moveTo(bx - 10, 0);
    ctx.quadraticCurveTo(bx + 8, 6 + wave * 0.2, bx + 16, 16 + wave * 0.5);
    ctx.quadraticCurveTo(bx + 6, 24, bx - 8, 16);
    ctx.closePath(); ctx.fill();
  }

  private _drawBelt(ctx: CanvasRenderingContext2D, skin: SkinDef): void {
    const bw = GAME_CONFIG.PLAYER_WIDTH - 14;
    ctx.fillStyle = skin.beltColor;
    ctx.beginPath(); ctx.roundRect(-bw / 2, 12, bw, 7, 3); ctx.fill();
    ctx.fillStyle = '#F59E0B';
    ctx.beginPath(); ctx.roundRect(-5, 13, 10, 5, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
    ctx.strokeRect(-5, 13, 10, 5);
  }

  private _drawBoots(ctx: CanvasRenderingContext2D, _skin: SkinDef): void {
    const H     = GAME_CONFIG.PLAYER_HEIGHT;
    const bootY = H / 2 + 10;
    const legSwing  = this.state === 'running' ? Math.sin(this.runCycle) * 4 : 0;
    const legSwing2 = this.state === 'running' ? Math.sin(this.runCycle + Math.PI) * 4 : 0;
    ctx.fillStyle = '#DC2626';
    ctx.beginPath(); ctx.roundRect(-GAME_CONFIG.PLAYER_WIDTH / 2 + 6, bootY + legSwing,  13, 8, [0,0,4,4]); ctx.fill();
    ctx.beginPath(); ctx.roundRect( GAME_CONFIG.PLAYER_WIDTH / 2 - 19, bootY + legSwing2, 13, 8, [0,0,4,4]); ctx.fill();
  }

  private _drawMask(ctx: CanvasRenderingContext2D): void {
    const hBase = -GAME_CONFIG.PLAYER_HEIGHT / 4 - 4;
    ctx.fillStyle = '#DC2626';
    ctx.beginPath();
    ctx.roundRect(-14, hBase - 11, 28, 8, 4);
    ctx.fill();
  }

  // Hitbox (for future use / debug)
  get hitbox(): { x: number; y: number; w: number; h: number } {
    return {
      x: this.x + 8,
      y: this.y + 6,
      w: GAME_CONFIG.PLAYER_WIDTH  - 16,
      h: GAME_CONFIG.PLAYER_HEIGHT - 12,
    };
  }
}
