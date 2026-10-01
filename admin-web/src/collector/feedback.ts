/** Optional audio (WebAudio beeps, no files) and vibration. Fails silently where unsupported. */
export type FeedbackKind = "success" | "warning" | "offline" | "error";

const SOUND_KEY = "givova.coleta.sound";
let ctx: AudioContext | null = null;

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

function tone(freq: number, start: number, duration: number) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.08, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.02);
}

/** Unlocks audio; call inside a keydown/click handler (scanner keystrokes count as user activation). */
export function primeAudio() {
  try {
    if (!soundEnabled()) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* ignore */
  }
}

/** Plays feedback; audio works once primeAudio() ran during a user interaction. */
export function feedback(kind: FeedbackKind) {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(kind === "success" ? 40 : kind === "error" ? [80, 60, 80] : kind === "offline" ? 25 : [40, 40, 40]);
    }
  } catch {
    /* ignore */
  }
  if (!soundEnabled()) return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    if (ctx.state === "suspended") void ctx.resume();
    if (kind === "success") tone(1760, 0, 0.09);
    else if (kind === "offline") tone(990, 0, 0.12);
    else if (kind === "warning") { tone(660, 0, 0.1); tone(660, 0.14, 0.1); }
    else { tone(330, 0, 0.18); tone(220, 0.2, 0.25); }
  } catch {
    /* ignore */
  }
}
