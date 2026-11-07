// ============================================================
// FART MAN — Audio Utilities (thin helpers used by AudioManager)
// ============================================================

export function createAudio(src: string): HTMLAudioElement {
  const audio = new Audio(src);
  audio.preload = 'auto';
  return audio;
}

export function safePlay(audio: HTMLAudioElement): Promise<void> {
  try {
    return audio.play().catch(() => {
      // Autoplay blocked – silently swallow
    });
  } catch {
    return Promise.resolve();
  }
}

export function safePause(audio: HTMLAudioElement): void {
  try {
    audio.pause();
  } catch {
    // ignore
  }
}
