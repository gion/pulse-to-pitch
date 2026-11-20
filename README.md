# Pulse to Pitch

An interactive sound experiment: play a polyrhythm and speed it up until it becomes a chord,
then slow a chord down until you can count its pulses.

**Play it:** https://gion.github.io/pulse-to-pitch/

Plain HTML + JavaScript + Web Audio. No build step, no dependencies.

## Experiments
- **Pulse → Pitch** — 2–3 voices at integer ratios (2:3, 4:5:6…) or equal-tempered notes.
  One speed control (0.25–512 Hz) multiplies every voice. "Sweep to pitch" glides 2 Hz → 220 Hz
  in 8 s; "Chord speed" jumps straight to 220 Hz. Wave-meeting diagram, pulse timeline, live
  spectrum.
- **Loop → Timbre** — a 16-step loop with your own sounds (microphone, audio file or short
  video; up to 350 ms per hit). Two playback modes:
  - *Compress the whole loop* — plays the recording faster (pitch and length change).
  - *Repeat hits at original speed* — every hit keeps its own speed; only the gaps shrink.
  "Sweep to pitch" goes 0.5 → 110 loops per second.
- **Voicing → Rhythm** — a five-note chord (C13, Cmaj9, G7alt or custom) slowed down by one
  factor until every note is a pulse.

## Run locally
```bash
python3 -m http.server 5173
```
Then open http://localhost:5173. Microphone recording needs `localhost` or HTTPS.

## Origin
Prototyped as a ChatGPT-hosted site and moved here (2026-11) so it has a stable public link.
Featured in episode 1 of the "music-tech-videos" series.
