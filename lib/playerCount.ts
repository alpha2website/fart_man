// ============================================================
// FART MAN — Live Player Count
// Uses BroadcastChannel so every open tab in the same browser
// knows how many tabs are currently playing.
// Falls back to a simple simulated count when BroadcastChannel
// is unavailable (some older browsers / private mode).
// ============================================================

type CountCallback = (count: number) => void;

const CHANNEL_NAME = 'fartman_players';
const STORAGE_KEY  = 'fartman_player_tabs';
const SESSION_KEY  = 'fartman_session_id';
const PING_INTERVAL = 8_000;   // ms — keep-alive broadcast
const TIMEOUT       = 20_000;  // ms — consider tab dead after this

// ---- helpers ----

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function getSessionId(): string {
  if (typeof sessionStorage === 'undefined') return genId();
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) { id = genId(); sessionStorage.setItem(SESSION_KEY, id); }
  return id;
}

// ---- main class ----

export class PlayerCountTracker {
  private myId: string;
  private channel: BroadcastChannel | null = null;
  private peers: Map<string, number> = new Map(); // id → lastSeen ts
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private callbacks: Set<CountCallback> = new Set();
  private simulatedCount = 0;
  private simTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (typeof window === 'undefined') { this.myId = genId(); return; }
    this.myId = getSessionId();

    // Always initialize a base simulated count for realistic feel
    this.simulatedCount = 3 + Math.floor(Math.random() * 5);

    if (typeof BroadcastChannel !== 'undefined') {
      this._initChannel();
      // Also run a gentle simulated fluctuation for the "other players" base
      this.simTimer = setInterval(() => {
        const delta = Math.random() < 0.5 ? 1 : -1;
        this.simulatedCount = Math.max(2, Math.min(12, this.simulatedCount + delta));
        this._notify();
      }, 10_000);
    } else {
      this._initSimulated();
    }
  }

  // ---- Public API ----

  /** Register a callback that fires whenever the count changes */
  subscribe(cb: CountCallback): () => void {
    this.callbacks.add(cb);
    cb(this._count());
    return () => this.callbacks.delete(cb);
  }

  get count(): number { return this._count(); }

  destroy(): void {
    if (this.pingTimer)    clearInterval(this.pingTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.simTimer)     clearInterval(this.simTimer);
    this._broadcast('leave');
    this.channel?.close();
    this.channel = null;
    this.callbacks.clear();
  }

  // ---- BroadcastChannel implementation ----

  private _initChannel(): void {
    try {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (e) => this._onMessage(e.data);

      // Register self
      this.peers.set(this.myId, Date.now());

      // Announce presence to other tabs
      this._broadcast('join');

      // Regular keep-alive
      this.pingTimer = setInterval(() => {
        this.peers.set(this.myId, Date.now());
        this._broadcast('ping');
      }, PING_INTERVAL);

      // Remove stale peers
      this.cleanupTimer = setInterval(() => {
        const now = Date.now();
        let changed = false;
        this.peers.forEach((ts, id) => {
          if (id !== this.myId && now - ts > TIMEOUT) {
            this.peers.delete(id);
            changed = true;
          }
        });
        if (changed) this._notify();
      }, TIMEOUT / 2);

      // Clean up on page unload
      window.addEventListener('beforeunload', () => this.destroy());
    } catch {
      this._initSimulated();
    }
  }

  private _onMessage(data: { type: string; id: string }): void {
    if (!data || data.id === this.myId) return;
    switch (data.type) {
      case 'join':
        this.peers.set(data.id, Date.now());
        this._broadcast('pong');   // let new tab know we exist
        this._notify();
        break;
      case 'ping':
      case 'pong':
        this.peers.set(data.id, Date.now());
        this._notify();
        break;
      case 'leave':
        this.peers.delete(data.id);
        this._notify();
        break;
    }
  }

  private _broadcast(type: string): void {
    try { this.channel?.postMessage({ type, id: this.myId }); } catch { /* ignore */ }
  }

  // ---- Simulated count (fallback — makes it feel alive) ----

  private _initSimulated(): void {
    // Start with a lively count
    this.simulatedCount = 3 + Math.floor(Math.random() * 6);
    this.simTimer = setInterval(() => {
      const delta = Math.random() < 0.5 ? 1 : -1;
      this.simulatedCount = Math.max(2, Math.min(15, this.simulatedCount + delta));
      this._notify();
    }, 8_000);
  }

  // ---- Helpers ----

  private _count(): number {
    if (this.channel) {
      // BroadcastChannel counts actual local tabs.
      // Add a simulated "other players online" base so the count
      // feels realistic even with just 1 tab open.
      const localTabs = this.peers.size;
      const base = this.simulatedCount || (3 + Math.floor(Math.random() * 5));
      return localTabs + base;
    }
    return this.simulatedCount;
  }

  private _notify(): void {
    const c = this._count();
    this.callbacks.forEach((cb) => cb(c));
  }
}
