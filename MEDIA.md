# Media assets

Drop files in `public/media/`. Nothing here is committed yet — the site renders a
designed court-line placeholder until these exist.

| File | Purpose |
|---|---|
| `hero.mp4` | Hero background loop (H.264) |
| `hero.webm` | Same loop, VP9 — smaller, served first |
| `hero-poster.jpg` | Still frame; what phones and slow connections show |

## Encoding the drone footage

Target **6–10 seconds, silent, under ~4 MB**. A raw 4K clip will be 200 MB+ and is
not acceptable on a page members open twice a week from cellular.

```bash
# 1080p H.264 — broad compatibility
ffmpeg -i drone-raw.mov -t 8 -an \
  -vf "scale=1920:-2,fps=30" \
  -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p -movflags +faststart \
  public/media/hero.mp4

# VP9 WebM — typically 30-40% smaller, browsers pick this first
ffmpeg -i drone-raw.mov -t 8 -an \
  -vf "scale=1920:-2,fps=30" \
  -c:v libvpx-vp9 -crf 34 -b:v 0 -row-mt 1 \
  public/media/hero.webm

# Poster frame
ffmpeg -i drone-raw.mov -ss 2 -vframes 1 -vf "scale=1920:-2" -q:v 3 \
  public/media/hero-poster.jpg
```

`-an` strips audio (no autoplay sound, ever). `+faststart` moves the index to the
front so playback starts before the file finishes downloading.

Pick a clip with **slow, continuous motion** — a steady orbit or push-in. Fast
movement looks bad at CRF 26 and draws attention away from the headline.

Once on Cloudflare, these move to R2 so video bandwidth stays free.
