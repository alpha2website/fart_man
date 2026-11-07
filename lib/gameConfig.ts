// ============================================================
// FART MAN: THE ULTIMATE GAS ESCAPE — Game Configuration
// PLATFORMER EDITION: Fart Man runs on buildings, jumps over gaps
// ============================================================

export const GAME_CONFIG = {
  // Canvas
  CANVAS_WIDTH: 480,
  CANVAS_HEIGHT: 720,

  // Platformer Physics
  GRAVITY: 0.55,
  FART_IMPULSE: -11.5,       // jump strength (upward velocity)
  MAX_UP_VELOCITY: -14,
  MAX_DOWN_VELOCITY: 14,
  RUN_SPEED: 3.2,             // how fast world scrolls (player runs at this speed)
  RUN_SPEED_MAX: 6.5,

  // Platform / Building rooftops
  PLATFORM_HEIGHT: 28,        // thickness of the rooftop surface
  PLATFORM_MIN_WIDTH: 80,     // min building rooftop width
  PLATFORM_MAX_WIDTH: 180,    // max building rooftop width
  GAP_MIN_WIDTH: 80,          // min gap between buildings — jumpable at start speed
  GAP_MAX_WIDTH: 155,         // max gap — increases with score
  PLATFORM_Y_MIN: 0.45,       // rooftop Y as fraction of canvas height (high)
  PLATFORM_Y_MAX: 0.78,       // rooftop Y as fraction of canvas height (low)
  PLATFORM_Y_CHANGE_MAX: 90,  // max vertical jump between consecutive platforms

  // Scoring
  SCORE_PER_GAP: 1,
  SCORE_PER_COLLECTIBLE: 5,

  // Gas Boost Meter
  GAS_METER_MAX: 100,
  GAS_BOOST_DURATION: 5000,   // ms
  GAS_BOOST_MULTIPLIER: 1.6,  // fart impulse multiplier during boost

  // Player
  PLAYER_WIDTH: 52,
  PLAYER_HEIGHT: 64,
  PLAYER_SCREEN_X: 100,       // fixed screen X position (left-side, Google Dino style)

  // Collectibles
  COLLECTIBLE_SPAWN_CHANCE: 0.45,

  // Difficulty progression every N gaps cleared
  DIFFICULTY_STEP: 8,

  // Background
  PARALLAX_SPEEDS: [0.08, 0.2, 0.45, 1.0],
} as const;

export type GameState = 'menu' | 'playing' | 'paused' | 'gameover';

export type SkinId = 'default' | 'grandpa' | 'baby' | 'businessman' | 'atomic';

export interface SkinDef {
  id: SkinId;
  name: string;
  emoji: string;
  bodyColor: string;
  suitColor: string;
  capeColor: string;
  beltColor: string;
  glowColor?: string;
}

export const SKINS: SkinDef[] = [
  {
    id: 'default',
    name: 'Fart Man',
    emoji: '💨',
    bodyColor: '#FFDEA0',
    suitColor: '#2563EB',
    capeColor: '#DC2626',
    beltColor: '#FBBF24',
  },
  {
    id: 'grandpa',
    name: 'Grandpa Gas',
    emoji: '👴',
    bodyColor: '#E8C9A0',
    suitColor: '#6B7280',
    capeColor: '#7C3AED',
    beltColor: '#D97706',
  },
  {
    id: 'baby',
    name: 'Baby Blaster',
    emoji: '👶',
    bodyColor: '#FFF0C8',
    suitColor: '#EC4899',
    capeColor: '#F9A8D4',
    beltColor: '#FDE68A',
  },
  {
    id: 'businessman',
    name: 'Businessman Fart',
    emoji: '💼',
    bodyColor: '#FFDEA0',
    suitColor: '#1F2937',
    capeColor: '#DC2626',
    beltColor: '#6B7280',
  },
  {
    id: 'atomic',
    name: 'Atomic Fart',
    emoji: '☢️',
    bodyColor: '#A3E635',
    suitColor: '#166534',
    capeColor: '#4ADE80',
    beltColor: '#86EFAC',
    glowColor: '#84CC16',
  },
];

export const FUNNY_GAMEOVER_MESSAGES = [
  "Your gas supply has been exhausted!",
  "Even your stomach gave up!",
  "The city survived. Barely.",
  "That was a powerful failure!",
  "Fart Man needs emergency maintenance!",
  "The pressure was too much to handle!",
  "Your propulsion system has failed!",
  "That gap was too wide for your gas!",
  "Wind: 0. Gap: 1.",
  "Better luck next toot!",
  "The rooftops are unforgiving!",
  "Next time, eat more beans first!",
];

export const SCORE_MESSAGES: { min: number; message: string }[] = [
  { min: 0,  message: "Just warming up..." },
  { min: 5,  message: "Getting gassy!" },
  { min: 15, message: "On a roll... er, toot!" },
  { min: 30, message: "Super Fart Man!" },
  { min: 50, message: "LEGENDARY GAS MASTER!" },
];
