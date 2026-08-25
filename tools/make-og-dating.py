#!/usr/bin/env python3
"""Render the link-preview card for the dating document.

A collage of three images pulled straight out of the document: the opening
photo, Loki, and the Big Five chart. Re-run after swapping any of them:

    python3 tools/make-og-dating.py

Writes og-card-dating.jpg (1200x630 at 2x) next to the page. JPEG, not
PNG: the card is mostly photographs, and a 2 MB preview image is one some
scrapers give up on.
"""
import pathlib, sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
IMG  = ROOT / "images" / "dating"
OUT  = ROOT / "og-card-dating.jpg"

# the three pieces of the collage, in document order
LEAD  = IMG / "00.jpg"   # opening photo: giving the EA talk
CAT   = IMG / "07.jpg"   # Loki
BIG5  = IMG / "11.png"   # Big Five bar chart

# 11.png carries whitespace and an export icon on the right; show only the
# chart itself. Numbers are source pixels in a 1456x524 image.
BIG5_W, BIG5_CROP_W, BIG5_CROP_H = 1456, 1410, 478

HTML = """<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Raleway:wght@600&display=swap" rel="stylesheet">
<style>
:root{
  --surface:#fcfdf7; --on-surface:#191c19; --on-surface-variant:#424940;
  --outline-variant:#c1c9be; --gold:#705d00; --primary:#0e6d35;
}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;background:var(--surface);
  color:var(--on-surface);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;
  font-weight:400;line-height:1.6;-webkit-font-smoothing:antialiased}
.card{display:flex;width:1200px;height:630px}

/* two full-bleed photos down the left */
.photos{display:flex;gap:2px;background:var(--surface);flex:0 0 620px}
.photos img{height:630px;object-fit:cover;border:0}
.photos .lead{width:330px;object-position:52%% 50%%}
.photos .cat{width:288px;object-position:44%% 56%%}

.side{flex:1;padding:40px;display:flex;flex-direction:column;
  border-left:1px solid var(--outline-variant)}
.eb{font-size:14px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;
  color:var(--gold);margin-bottom:10px}
h1{font-family:"Raleway",sans-serif;font-weight:600;font-size:46px;line-height:1.08;
  letter-spacing:-.015em;margin-bottom:14px}
.dek{font-size:17px;color:var(--on-surface-variant);margin-bottom:20px}
.facts{list-style:none;padding:0;font-size:16px;line-height:1.5}
.facts li{padding-left:18px;position:relative;margin-bottom:7px}
.facts li:before{content:"";position:absolute;left:0;top:10px;width:7px;height:7px;
  background:var(--gold)}
.rule{border-top:1px solid var(--outline-variant);margin:auto 0 22px}

/* the Big Five chart, cropped to the plot area */
.chart{width:%(cw)dpx;height:%(ch)dpx;overflow:hidden;
  border:1px solid var(--outline-variant);background:#fff}
.chart img{width:%(iw)dpx;height:auto;max-width:none}
.scores{margin-top:12px;font-size:15px;color:var(--on-surface-variant);
  display:flex;justify-content:space-between}
.scores b{color:var(--on-surface);font-weight:600}
.url{margin-top:18px;font-size:15px;font-weight:600;color:var(--primary)}
</style></head><body>
<div class="card">
  <div class="photos">
    <img class="lead" src="%(lead)s" alt="">
    <img class="cat" src="%(cat)s" alt="">
  </div>
  <div class="side">
    <p class="eb">Becoming Stronger</p>
    <h1>Dating Document</h1>
    <p class="dek">Not your typical dating profile. Kansas City, 32, philosophy
      nerd, effective altruism organizer, and one very well-behaved cat.</p>
    <ul class="facts">
      <li>Organizes Effective Altruism KC, donates 10%% of his income</li>
      <li>Vegan. D&amp;D, urban exploration, foraging, Burning Man</li>
      <li>Looking for a life partner in the next 3-5 years</li>
    </ul>
    <div class="rule"></div>
    <div class="chart"><img src="%(big5)s" alt=""></div>
    <div class="scores">
      <span>O&nbsp;<b>92</b></span><span>C&nbsp;<b>84</b></span>
      <span>E&nbsp;<b>91</b></span><span>A&nbsp;<b>98</b></span>
      <span>N&nbsp;<b>60</b></span>
    </div>
    <p class="url">becomingstronger.github.io/dating</p>
  </div>
</div>
</body></html>"""


def main():
    for p in (LEAD, CAT, BIG5):
        if not p.exists():
            sys.exit("missing %s" % p)

    chart_w = 500                                    # inner width of .side
    img_w   = round(chart_w * BIG5_W / BIG5_CROP_W)  # scale up, then clip
    chart_h = round(chart_w * BIG5_CROP_H / BIG5_CROP_W)

    rel = lambda q: q.relative_to(ROOT).as_posix()
    html = HTML % {"lead": rel(LEAD), "cat": rel(CAT), "big5": rel(BIG5),
                   "cw": chart_w, "ch": chart_h, "iw": img_w}

    # a file:// page so the <img> paths resolve; set_content would leave the
    # document on about:blank, where they cannot load
    tmp = ROOT / ".og-card-dating.tmp.html"
    tmp.write_text(html)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={"width": 1200, "height": 630},
                            device_scale_factor=2, reduced_motion="reduce")
            pg.goto(tmp.as_uri(), wait_until="networkidle")
            n = pg.eval_on_selector_all("img", "els => els.filter(e => e.naturalWidth).length")
            if n != 3:
                sys.exit("only %d of 3 collage images loaded" % n)
            pg.locator(".card").screenshot(path=str(OUT), type="jpeg", quality=90)
            b.close()
    finally:
        tmp.unlink(missing_ok=True)
    print("wrote %s (%d KB)" % (OUT.name, OUT.stat().st_size // 1024))


if __name__ == "__main__":
    main()
