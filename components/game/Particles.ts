// ============================================================
// FART MAN — Particles & Effects
// ============================================================

import { randFloat, randInt } from '@/lib/physics';

export type ParticleType =
  | 'fart_small'
  | 'fart_big'
  | 'fart_rainbow'
  | 'fart_ring'
  | 'fart_turbo'
  | 'score_pop'
  | 'collectible_sparkle'
  | 'boost_burst'
  | 'crash_star';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  alphaDecay: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  scaleX: number;
  type: ParticleType;
  life: number; // 0..1
  lifeDecay: number;
  text?: string;
}

const FART_COLORS = [
  '#86EFAC', '#4ADE80', '#22C55E', '#BEF264', '#A3E635',
];
const RAINBOW_COLORS = [
  '#F87171', '#FB923C', '#FBBF24', '#86EFAC', '#60A5FA', '#C084FC',
];

export class ParticleSystem {
  private pool: Particle[] = [];
  private active: Particle[] = [];

  private getParticle(): Particle {
    return (
      this.pool.pop() ?? {
        x: 0, y: 0, vx: 0, vy: 0, radius: 4, alpha: 1, alphaDecay: 0.02,
        color: '#86EFAC', rotation: 0, rotationSpeed: 0, scaleX: 1,
        type: 'fart_small', life: 1, lifeDecay: 0.02,
      }
    );
  }

  emit(type: ParticleType, x: number, y: number, count = 1): void {
    for (let i = 0; i < count; i++) {
      const p = this.getParticle();
      p.x = x;
      p.y = y;
      p.alpha = 1;
      p.life = 1;
      p.rotation = randFloat(0, Math.PI * 2);
      p.type = type;

      switch (type) {
        case 'fart_small':
          p.vx = randFloat(-2.5, -0.5);
          p.vy = randFloat(-1.5, 1.5);
          p.radius = randFloat(8, 18);
          p.color = FART_COLORS[randInt(0, FART_COLORS.length - 1)];
          p.alphaDecay = randFloat(0.015, 0.03);
          p.lifeDecay = 0.025;
          p.scaleX = randFloat(0.8, 1.2);
          p.rotationSpeed = randFloat(-0.05, 0.05);
          break;

        case 'fart_big':
          p.vx = randFloat(-4, -1);
          p.vy = randFloat(-2, 2);
          p.radius = randFloat(22, 40);
          p.color = FART_COLORS[randInt(0, FART_COLORS.length - 1)];
          p.alphaDecay = 0.012;
          p.lifeDecay = 0.018;
          p.scaleX = randFloat(0.7, 1.3);
          p.rotationSpeed = randFloat(-0.03, 0.03);
          break;

        case 'fart_rainbow':
          p.vx = randFloat(-3, -0.5);
          p.vy = randFloat(-2, 2);
          p.radius = randFloat(10, 24);
          p.color = RAINBOW_COLORS[randInt(0, RAINBOW_COLORS.length - 1)];
          p.alphaDecay = 0.014;
          p.lifeDecay = 0.02;
          p.scaleX = 1;
          p.rotationSpeed = 0.1;
          break;

        case 'fart_ring': {
          const angle = (i / count) * Math.PI * 2;
          const speed = randFloat(1.5, 3);
          p.vx = Math.cos(angle) * speed - 2;
          p.vy = Math.sin(angle) * speed;
          p.radius = randFloat(6, 14);
          p.color = '#A3E635';
          p.alphaDecay = 0.02;
          p.lifeDecay = 0.025;
          p.scaleX = 1;
          p.rotationSpeed = 0;
          break;
        }

        case 'fart_turbo':
          p.vx = randFloat(-7, -3);
          p.vy = randFloat(-1, 1);
          p.radius = randFloat(6, 12);
          p.color = '#FDE047';
          p.alphaDecay = 0.03;
          p.lifeDecay = 0.04;
          p.scaleX = 2.5;
          p.rotationSpeed = 0;
          break;

        case 'score_pop':
          p.vx = randFloat(-0.5, 0.5);
          p.vy = -3;
          p.radius = 0;
          p.color = '#FBBF24';
          p.alphaDecay = 0.02;
          p.lifeDecay = 0.025;
          p.scaleX = 1;
          p.rotationSpeed = 0;
          p.text = '+1';
          break;

        case 'collectible_sparkle':
          p.vx = randFloat(-2, 2);
          p.vy = randFloat(-3, -1);
          p.radius = randFloat(3, 7);
          p.color = '#FBBF24';
          p.alphaDecay = 0.03;
          p.lifeDecay = 0.035;
          p.scaleX = 1;
          p.rotationSpeed = randFloat(-0.1, 0.1);
          break;

        case 'boost_burst':
          p.vx = Math.cos(randFloat(0, Math.PI * 2)) * randFloat(2, 6);
          p.vy = Math.sin(randFloat(0, Math.PI * 2)) * randFloat(2, 6);
          p.radius = randFloat(8, 20);
          p.color = RAINBOW_COLORS[randInt(0, RAINBOW_COLORS.length - 1)];
          p.alphaDecay = 0.025;
          p.lifeDecay = 0.03;
          p.scaleX = 1;
          p.rotationSpeed = 0.05;
          break;

        case 'crash_star': {
          const a = (i / count) * Math.PI * 2;
          p.vx = Math.cos(a) * randFloat(3, 7);
          p.vy = Math.sin(a) * randFloat(3, 7);
          p.radius = randFloat(5, 10);
          p.color = '#FDE047';
          p.alphaDecay = 0.02;
          p.lifeDecay = 0.025;
          p.scaleX = 1;
          p.rotationSpeed = 0.1;
          break;
        }
      }

      this.active.push(p);
    }
  }

  update(deltaTime: number): void {
    const dt = deltaTime / 16.67;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 0.05 * dt; // micro gravity
      p.alpha -= p.alphaDecay * dt;
      p.life -= p.lifeDecay * dt;
      p.rotation += p.rotationSpeed * dt;
      p.radius += 0.15 * dt; // expand

      if (p.alpha <= 0 || p.life <= 0) {
        this.active.splice(i, 1);
        this.pool.push(p);
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const p of this.active) {
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);

      if (p.text) {
        // Score pop text
        ctx.fillStyle = p.color;
        ctx.font = `bold ${12 + (1 - p.life) * 8}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.text, 0, 0);
      } else if (p.type === 'crash_star') {
        this._drawStar(ctx, 0, 0, p.radius * 0.5, p.radius, 5, p.color);
      } else {
        // Cloud / blob
        ctx.scale(p.scaleX, 1);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.fill();

        // Inner lighter blob
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.beginPath();
        ctx.arc(-p.radius * 0.25, -p.radius * 0.2, p.radius * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private _drawStar(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    inner: number, outer: number,
    points: number, color: string
  ): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      if (i === 0) ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
      else ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    ctx.closePath();
    ctx.fill();
  }

  clear(): void {
    this.pool.push(...this.active);
    this.active = [];
  }

  get count(): number {
    return this.active.length;
  }
}
