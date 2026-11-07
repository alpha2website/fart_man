// ============================================================
// FART MAN — Physics Utilities (Platformer Edition)
// ============================================================

import { GAME_CONFIG } from './gameConfig';

export interface Vector2 {
  x: number;
  y: number;
}

/** Clamp a value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Linear interpolation */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Apply gravity and clamp vertical velocity */
export function applyGravity(
  velocityY: number,
  deltaTime: number,
  gravityMultiplier = 1
): number {
  const newVel = velocityY + GAME_CONFIG.GRAVITY * gravityMultiplier * (deltaTime / 16.67);
  return clamp(newVel, GAME_CONFIG.MAX_UP_VELOCITY, GAME_CONFIG.MAX_DOWN_VELOCITY);
}

/** Apply a fart (jump) impulse */
export function applyFartImpulse(
  boostMultiplier = 1
): number {
  return clamp(
    GAME_CONFIG.FART_IMPULSE * boostMultiplier,
    GAME_CONFIG.MAX_UP_VELOCITY,
    GAME_CONFIG.MAX_DOWN_VELOCITY
  );
}

/** Get current run speed based on score */
export function getRunSpeed(score: number): number {
  const steps = Math.floor(score / GAME_CONFIG.DIFFICULTY_STEP);
  const speed = GAME_CONFIG.RUN_SPEED + steps * 0.22;
  return Math.min(speed, GAME_CONFIG.RUN_SPEED_MAX);
}

/** Get current max gap width based on score */
export function getMaxGap(score: number): number {
  const steps = Math.floor(score / GAME_CONFIG.DIFFICULTY_STEP);
  const gap = GAME_CONFIG.GAP_MIN_WIDTH + steps * 6;
  return Math.min(gap, GAME_CONFIG.GAP_MAX_WIDTH);
}

/** Simple AABB collision — returns true if rects overlap */
export function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/** Circle vs rectangle overlap */
export function circleRectOverlap(
  cx: number, cy: number, cr: number,
  rx: number, ry: number, rw: number, rh: number
): boolean {
  const nearestX = clamp(cx, rx, rx + rw);
  const nearestY = clamp(cy, ry, ry + rh);
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return dx * dx + dy * dy < cr * cr;
}

/** Ease out cubic */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Random int inclusive */
export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Random float */
export function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}
