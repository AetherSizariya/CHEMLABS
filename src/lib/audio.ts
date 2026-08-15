class AudioManager {
  private sounds: Record<string, HTMLAudioElement> = {};
  private bubbleTimer: ReturnType<typeof setTimeout> | null = null;
  private bubbleActive = false;
  private unlocked = false;

  /** Call after a user gesture so subsequent play() calls are allowed. */
  public unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    // Warm up a silent buffer via a short play/pause on a known asset.
    try {
      const a = new Audio('/pop.mp3');
      a.volume = 0.001;
      a.play().then(() => {
        a.pause();
        a.currentTime = 0;
      }).catch(() => {});
    } catch {
      // ignore
    }
  }

  private playSound(path: string, loop: boolean = false) {
    this.unlock();
    if (!this.sounds[path]) {
      this.sounds[path] = new Audio(path);
    }
    const sound = this.sounds[path];
    sound.loop = loop;
    try {
      sound.currentTime = 0;
    } catch {
      // ignore seek errors
    }
    sound.play().catch(e => console.error("Audio play failed:", path, e));
  }
  
  public stopSound(path: string) {
      if (this.sounds[path]) {
          this.sounds[path].pause();
          this.sounds[path].currentTime = 0;
      }
  }

  public stopAll() {
      this.stopMix();
      for (const key in this.sounds) {
          this.sounds[key].pause();
          this.sounds[key].currentTime = 0;
      }
  }

  public playPour() {
    this.playSound('/pour.mp3');
  }

  /**
   * Repeated bubbling with audible gaps (target ~0.8–1.5 s between events).
   * Uses a single scheduled chain — no overlapping loops, no machine-gun
   * of hundreds of Audio objects, cleaned up on stopMix / stopAll.
   */
  public playMix() {
    this.unlock();
    // One scheduler only. Do not also run an ambient bubbling loop: the same
    // sound asset is used for discrete bubble events, and an ambient loop
    // makes the perceived cadence much faster than the simulation intends.
    if (this.bubbleActive) return;
    this.bubbleActive = true;

    const scheduleNext = () => {
      if (!this.bubbleActive) return;
      // 1.2–2.0 s between bubble starts, with natural variation (bubble — pause — bubble).
      const delay = 1200 + Math.random() * 800;
      this.bubbleTimer = setTimeout(() => {
        if (!this.bubbleActive) return;

        const bubble = new Audio('/bubbling.mp3');
        bubble.volume = 0.42 + Math.random() * 0.18;
        bubble.playbackRate = 0.9 + Math.random() * 0.2;
        bubble.play().catch(() => {});
        bubble.addEventListener('ended', () => {
          bubble.src = '';
        }, { once: true });

        scheduleNext();
      }, delay);
    };

    scheduleNext();
  }

  public stopMix() {
    this.stopSound('/bubbling.mp3');
    this.bubbleActive = false;
    if (this.bubbleTimer) {
      clearTimeout(this.bubbleTimer);
      this.bubbleTimer = null;
    }
  }

  public playIgnite() {
    this.playSound('/ignite.mp3');
  }
  
  public playBurn() {
    this.playSound('/burn.mp3', true);
  }
  
  public stopBurn() {
      this.stopSound('/burn.mp3');
  }

  public playPop() {
    this.unlock();
    // Fresh instance so rapid successive pops can overlap if needed
    const pop = new Audio('/pop.mp3');
    pop.volume = 1.0;
    const tryPlay = () => {
      pop.play().catch(e => console.error("Pop failed:", e));
    };
    // If metadata not ready yet, wait briefly
    if (pop.readyState >= 2) {
      tryPlay();
    } else {
      pop.addEventListener('canplaythrough', tryPlay, { once: true });
      pop.load();
      // Fallback in case canplaythrough never fires
      setTimeout(tryPlay, 150);
    }
  }
  
  public playExplosion() {
    this.unlock();
    const exp = new Audio('/explosion.mp3');
    exp.volume = 1.0;
    exp.play().catch(e => console.error("Explosion failed:", e));
  }
}

export const audio = new AudioManager();
