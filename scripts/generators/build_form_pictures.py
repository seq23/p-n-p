#!/usr/bin/env python3
"""Small web copies of the site's own photos for the request form's first question (owner-approved
mock-up, 20 Oct 2026) and the thank-you email's service thumbnails.

  assets/img/form/<key>-240.webp, <key>-480.webp   4:3, for the picture tiles (srcset 240w/480w)
  assets/img/form/<key>-email.jpg                  128x128 JPEG, for the thank-you email (cid images)

The party tile is two photos side by side (a birthday balloon entry + a hotel-room surprise). The
sources are the real photos in assets/img (never the placeholder drawings that
validate:no-placeholder-images rejects). Deterministic for the same inputs; run by hand with
`npm run build:form-pictures` (needs Python Pillow) and commit the output: Cloudflare Pages
copies assets/ as they are.
"""
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/img/form'
SOURCES = {
    'porch': ['assets/img/porch/memphis-fall-front-porch-decorating-germantown.jpg'],
    'party': ['assets/img/celebrations/birthday-entry-celebration.jpg', 'assets/img/celebrations/romantic-bedroom-experience.jpg'],
    'grazing': ['assets/img/grazing/grazing-table-corporate.jpg'],
    'rentals': ['assets/rentals/giant-connect-four.webp'],
}


def tile(paths, w, h):
    imgs = [Image.open(ROOT / p).convert('RGB') for p in paths]
    canvas = Image.new('RGB', (w, h), (255, 255, 255))
    part = w // len(imgs)
    for i, im in enumerate(imgs):
        pw = part if i < len(imgs) - 1 else w - part * i
        canvas.paste(ImageOps.fit(im, (pw, h), Image.LANCZOS, centering=(0.5, 0.45)), (part * i, 0))
    return canvas


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for key, paths in SOURCES.items():
        for w in (240, 480):
            tile(paths, w, w * 3 // 4).save(OUT / f'{key}-{w}.webp', 'WEBP', quality=78, method=6)
        tile(paths, 128, 128).save(OUT / f'{key}-email.jpg', 'JPEG', quality=82, optimize=True, progressive=False)
    print(f'form pictures: {len(SOURCES) * 3} files in {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
