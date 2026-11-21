import { MONSTER_ELEMENTS, type MonsterElement } from '../data/bestiary';
import type { AmbientBedKind, SkillVfxKind } from '../types/game';

interface MusicMotif {
  bpm: number;
  notes: number[]; // MIDI note numbers, 0 = rest
  bass: number[];
  leadWave: OscillatorType;
  padWave: OscillatorType;
}

const MOTIFS: Record<string, MusicMotif> = {
  login: {
    bpm: 78,
    notes: [57, 60, 64, 69, 67, 64, 60, 62, 57, 60, 64, 71, 69, 64, 60, 0],
    bass: [45, 0, 48, 0, 43, 0, 45, 0, 45, 0, 48, 0, 40, 0, 45, 0],
    leadWave: 'triangle',
    padWave: 'sine',
  },
  flaris: {
    bpm: 94,
    notes: [62, 65, 69, 74, 72, 69, 65, 67, 62, 65, 69, 72, 70, 69, 65, 64],
    bass: [38, 0, 45, 0, 41, 0, 45, 0, 38, 0, 43, 0, 45, 0, 38, 0],
    leadWave: 'triangle',
    padWave: 'sine',
  },
  robledal: {
    bpm: 96,
    notes: [64, 68, 71, 76, 73, 71, 68, 69, 64, 68, 73, 76, 75, 73, 71, 68],
    bass: [40, 0, 47, 0, 44, 0, 45, 0, 40, 0, 49, 0, 47, 0, 40, 0],
    leadWave: 'sine',
    padWave: 'triangle',
  },
  puerto: {
    bpm: 82,
    notes: [60, 64, 67, 71, 72, 71, 67, 64, 62, 65, 69, 72, 71, 67, 64, 0],
    bass: [36, 0, 43, 0, 40, 0, 43, 0, 38, 0, 45, 0, 43, 0, 36, 0],
    leadWave: 'sine',
    padWave: 'sine',
  },
  ceniza: {
    bpm: 118,
    notes: [56, 59, 63, 64, 68, 64, 63, 59, 56, 64, 68, 71, 68, 64, 63, 59],
    bass: [32, 32, 32, 39, 36, 36, 35, 35, 32, 32, 40, 40, 39, 39, 35, 32],
    leadWave: 'sawtooth',
    padWave: 'square',
  },
};

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

class MuSoundSynth {
  private ctx: AudioContext | null = null;
  public muted = false;
  public volume = 0.75;
  public musicEnabled = true;
  public musicVolume = 0.45;

  private activeTheme = 'login';
  private activeBed: AmbientBedKind = 'none';
  private seqTimer: number | null = null;
  private stepIdx = 0;

  private bedSource: AudioBufferSourceNode | null = null;
  private bedGain: GainNode | null = null;
  private lastCreatureSound = -Infinity;
  private wavCache = new Map<string, Promise<AudioBuffer | null>>();

  private playWav(relativeUrl: string, vol = 0.5): boolean {
    const ctx = this.ensureContext();
    if (!ctx || typeof fetch !== 'function') return false;
    const appBase = new URL(import.meta.env.BASE_URL || './', window.location.href);
    const base = new URL(relativeUrl.replace(/^\//, ''), appBase).href;
    let p = this.wavCache.get(base);
    if (!p) {
      p = fetch(base)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((ab) => (ab && this.ctx ? this.ctx.decodeAudioData(ab) : null))
        .catch(() => null);
      this.wavCache.set(base, p);
    }
    void p.then((buf) => {
      if (!buf || this.muted || !this.ctx || this.ctx.state !== 'running') return;
      const src = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      src.buffer = buf;
      gain.gain.value = Math.max(0.01, Math.min(1, vol * this.volume));
      src.connect(gain).connect(this.ctx.destination);
      src.onended = () => {
        src.disconnect();
        gain.disconnect();
      };
      src.start();
    });
    return true;
  }

  private ensureContext(allowWhenSfxMuted = false): AudioContext | null {
    if (!allowWhenSfxMuted && (this.muted || this.volume <= 0.01)) return null;
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public unlockAudio() {
    this.ensureContext(true);
    if (this.musicEnabled && !this.seqTimer) {
      this.startSequencer();
    }
  }

  private g(val: number) {
    return Math.max(0.0005, val * this.volume);
  }

  private mg(val: number) {
    return Math.max(0.0005, val * this.musicVolume);
  }

  public setMusicConfig(enabled: boolean, volume: number) {
    this.musicEnabled = enabled;
    this.musicVolume = Math.max(0, Math.min(1, volume));
    if (!enabled || this.musicVolume <= 0.01) {
      this.stopMusic();
    } else if (!this.seqTimer) {
      this.startSequencer();
    }
    if (this.bedGain && this.ctx) {
      this.bedGain.gain.setTargetAtTime(
        enabled ? this.mg(0.035) : 0.0001,
        this.ctx.currentTime,
        0.15,
      );
    }
  }

  public playMapMusic(theme: string, bed: AmbientBedKind = 'none') {
    this.activeTheme = MOTIFS[theme] ? theme : 'flaris';
    this.activeBed = bed;
    this.stepIdx = 0;
    if (this.musicEnabled) {
      this.startSequencer();
      this.startAmbientBed(bed);
    }
  }

  public stopMusic() {
    if (this.seqTimer !== null) {
      window.clearInterval(this.seqTimer);
      this.seqTimer = null;
    }
    this.stopAmbientBed();
  }

  private startSequencer() {
    if (this.seqTimer !== null) {
      window.clearInterval(this.seqTimer);
      this.seqTimer = null;
    }
    if (!this.musicEnabled || this.musicVolume <= 0.01) return;
    const motif = MOTIFS[this.activeTheme] || MOTIFS.flaris;
    const stepMs = Math.round((60 / motif.bpm / 2) * 1000);

    this.seqTimer = window.setInterval(() => {
      if (!this.musicEnabled || this.musicVolume <= 0.01) return;
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return;

      const curMotif = MOTIFS[this.activeTheme] || MOTIFS.flaris;
      const idx = this.stepIdx % curMotif.notes.length;
      this.stepIdx++;

      const now = ctx.currentTime;
      const leadMidi = curMotif.notes[idx];
      if (leadMidi > 0) {
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        osc.type = curMotif.leadWave;
        osc.frequency.setValueAtTime(midiToFreq(leadMidi), now);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1600, now);

        gain.gain.setValueAtTime(0.0005, now);
        gain.gain.linearRampToValueAtTime(this.mg(0.055), now + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0005, now + (stepMs / 1000) * 1.4);

        osc.connect(filter).connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + (stepMs / 1000) * 1.45);
      }

      const bassMidi = curMotif.bass[idx];
      if (bassMidi > 0) {
        const oscB = ctx.createOscillator();
        const gainB = ctx.createGain();
        oscB.type = curMotif.padWave;
        oscB.frequency.setValueAtTime(midiToFreq(bassMidi), now);
        gainB.gain.setValueAtTime(0.0005, now);
        gainB.gain.linearRampToValueAtTime(this.mg(0.065), now + 0.03);
        gainB.gain.exponentialRampToValueAtTime(0.0005, now + (stepMs / 1000) * 1.9);
        oscB.connect(gainB).connect(ctx.destination);
        oscB.start(now);
        oscB.stop(now + (stepMs / 1000) * 1.95);
      }
    }, stepMs);
  }

  private stopAmbientBed() {
    try {
      this.bedSource?.stop();
    } catch {
      // ignore
    }
    this.bedSource = null;
    this.bedGain = null;
  }

  private startAmbientBed(bed: AmbientBedKind) {
    this.stopAmbientBed();
    if (bed === 'none' || !this.musicEnabled) return;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;

    const sampleRate = ctx.sampleRate;
    const len = sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.03 * white) / 1.03;
      data[i] = lastOut * 3.2;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = bed === 'water' ? 'bandpass' : 'lowpass';
    filter.frequency.value =
      bed === 'water' ? 420 : bed === 'wind' ? 560 : bed === 'dungeon' ? 220 : bed === 'desert' ? 680 : 350;

    const gain = ctx.createGain();
    gain.gain.value = this.mg(0.032);

    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
    this.bedSource = src;
    this.bedGain = gain;
  }

  playSkillSfx(vfx: SkillVfxKind) {
    if (vfx === 'slash' || vfx === 'twisting' || vfx === 'death_stab' || vfx === 'power_slash') {
      this.playWav('/openmu/audio/eSwingLightSword.wav', 0.42);
      this.playSlash(vfx === 'twisting');
    } else if (vfx === 'buff') {
      this.playWav('/openmu/audio/eSwellLife.wav', 0.44);
      this.playTradeSync();
    } else if (vfx === 'arrow' || vfx === 'triple_shot' || vfx === 'ice_arrow') {
      this.playWav('/openmu/audio/ePiercing.wav', 0.42);
      this.playBowShot();
    } else if (vfx === 'nova' || vfx === 'hellfire' || vfx === 'gigantic_storm' || vfx === 'fire_scream') {
      this.playWav('/openmu/audio/eMeteorite.wav', 0.45);
      this.playHeavyImpact();
    } else if (vfx === 'lightning_shock') {
      this.playWav('/openmu/audio/eThunder.wav', 0.45);
      this.playMagic();
    } else if (vfx === 'rageful_blow' || vfx === 'blood_storm') {
      this.playWav('/openmu/audio/eBlow.wav', 0.46);
      this.playSlash(true);
    } else {
      this.playWav('/openmu/audio/sKnightSkill2.wav', 0.4);
      this.playMagic();
    }
  }

  playSlash(heavy = false) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(heavy ? 420 : 340, now);
    osc.frequency.exponentialRampToValueAtTime(85, now + 0.15);
    gain.gain.setValueAtTime(this.g(0.14), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  playBowShot() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(780, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.11);
    gain.gain.setValueAtTime(this.g(0.12), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  playMagic() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(190, now + 0.24);
    gain.gain.setValueAtTime(this.g(0.13), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.26);
  }

  playHeavyImpact() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [160, 320, 640].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i === 0 ? 'sine' : 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(55, now + 0.28);
      gain.gain.setValueAtTime(this.g(0.12), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.31);
    });
  }

  playCreatureSfx(element: MonsterElement, kind: 'strike' | 'power' | 'defeat' | 'greeting') {
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - this.lastCreatureSound < .08) return;
    this.lastCreatureSound = now;
    const pitch = MONSTER_ELEMENTS[element].hz;
    const duration = kind === 'strike' ? .13 : kind === 'defeat' ? .36 : .27;
    const detune = kind === 'strike' ? .76 : kind === 'defeat' ? .55 : 1;
    const osc = ctx.createOscillator(), overtone = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = ['stone','void','ember'].includes(element) ? 'sawtooth' : 'triangle';
    overtone.type = 'sine';
    osc.frequency.setValueAtTime(pitch * detune, now);
    osc.frequency.exponentialRampToValueAtTime(pitch * (kind === 'greeting' ? 1.42 : .34), now+duration);
    overtone.frequency.setValueAtTime(pitch*1.49, now);
    overtone.frequency.exponentialRampToValueAtTime(pitch*.64, now+duration);
    gain.gain.setValueAtTime(.001, now);
    gain.gain.linearRampToValueAtTime(Math.max(.001,this.g(kind === 'power' ? .095 : .063)), now+.018);
    gain.gain.exponentialRampToValueAtTime(.001, now+duration);
    osc.connect(gain); overtone.connect(gain); gain.connect(ctx.destination);
    osc.start(); overtone.start();
    osc.stop(now+duration); overtone.stop(now+duration);
    overtone.onended = () => { osc.disconnect(); overtone.disconnect(); gain.disconnect(); };
  }

  playMonsterHit() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(75, now + 0.08);
    gain.gain.setValueAtTime(this.g(0.08), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  playComboBurst() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [260, 440, 740].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = idx === 2 ? 'triangle' : 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + idx * 0.04);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.4, now + idx * 0.04 + 0.18);
      gain.gain.setValueAtTime(this.g(0.14), now + idx * 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.04 + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + idx * 0.04);
      osc.stop(now + idx * 0.04 + 0.22);
    });
  }

  playPickup(isJewel = false) {
    this.playWav('/flyff/audio/pickup.wav', isJewel ? 0.62 : 0.52);
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = isJewel ? [987.77, 1318.51, 1760] : [784, 1046.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.045);
      gain.gain.setValueAtTime(this.g(0.11), now + i * 0.045);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.045 + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.045);
      osc.stop(now + i * 0.045 + 0.17);
    });
  }

  playPotion() {
    this.playWav('/flyff/audio/potion.wav', 0.56);
    this.playTradeSync();
  }

  playEquip(isWing = false) {
    this.playWav(isWing ? '/flyff/audio/equip_wing.wav' : '/flyff/audio/equip_armor.wav', 0.58);
    this.playForge(true);
  }

  playJewelDrop() {
    this.playWav('/flyff/audio/drop_ding.wav', 0.56);
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [880, 1174.66, 1567.98].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.055);
      gain.gain.setValueAtTime(this.g(0.11), now + i * 0.055);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.055 + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.055);
      osc.stop(now + i * 0.055 + 0.3);
    });
  }

  playWarp() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(1120, now + 0.32);
    gain.gain.setValueAtTime(this.g(0.12), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.35);
  }

  playLevelUp() {
    this.playWav('/flyff/audio/levelup.wav', 0.62);
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.065);
      gain.gain.setValueAtTime(this.g(0.13), now + i * 0.065);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.065 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.065);
      osc.stop(now + i * 0.065 + 0.36);
    });
  }

  playForge(success: boolean) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = success ? 'triangle' : 'square';
    osc.frequency.setValueAtTime(success ? 620 : 180, now);
    osc.frequency.exponentialRampToValueAtTime(success ? 1240 : 80, now + 0.28);
    gain.gain.setValueAtTime(this.g(0.14), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.32);
  }

  playTradeSync() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.06);
      gain.gain.setValueAtTime(this.g(0.1), now + i * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.24);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.06);
      osc.stop(now + i * 0.06 + 0.25);
    });
  }
}

export const soundSynth = new MuSoundSynth();
