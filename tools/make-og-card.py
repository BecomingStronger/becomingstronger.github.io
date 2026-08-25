#!/usr/bin/env python3
"""Render the link-preview card for the cause prioritization page.

The card is the top rows of the per-problem breakdown, cloned out of the live
page so it can never disagree with the published ranking. Re-run after any
score change:

    python3 tools/make-og-card.py

Every string and the mount point are overridable, so the same script drives the
eakansascity.org port, which mounts inside its .cp scope and uses Montserrat.
"""
import argparse, pathlib, sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent

DEFAULTS = dict(
    page="kc-cause-prioritization.html",
    out="og-card-evidence.png",
    mount="body",
    eyebrow="Becoming Stronger",
    title="Where would a marginal dollar do the most good in Kansas City?",
    dek="Fifteen problems scored on impact, tractability and neglectedness. The top three:",
    foot_left="Burden model, cost-effectiveness ladder and funding map, with 10,000-draw rank intervals",
    foot_right="69 cited sources",
    title_font='"Raleway",sans-serif',
    rows=3,
)

CARD_CSS = """
#ogcard{position:fixed;left:0;top:0;width:1200px;height:630px;z-index:9999;
  background:var(--paper);padding:44px 48px;box-sizing:border-box;
  display:flex;flex-direction:column;gap:0;text-align:left}
#ogcard .eb{font-size:15px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;
  color:var(--leaf);margin:0 0 10px;line-height:1.2}
#ogcard h1{font-family:%(title_font)s;font-weight:600;font-size:40px;line-height:1.12;
  letter-spacing:-.015em;margin:0 0 6px;color:var(--ink);text-wrap:balance;max-width:1010px;
  padding:0;border:none;text-transform:none}
#ogcard .dek{font-size:17px;color:var(--ink-soft);margin:0 0 20px;line-height:1.4}
#ogcard .explorer{border:1px solid var(--line-strong)}
#ogcard .xrow{padding:13px 16px}
#ogcard .xtop{grid-template-columns:40px minmax(150px,.85fr) minmax(520px,1.9fr) 84px;gap:16px}
#ogcard .xrank{font-size:1.2rem;padding:5px 0}
#ogcard .xnm{font-size:1.13rem;font-weight:600;line-height:1.25}
#ogcard .fl{font-size:.72rem}
#ogcard .fv{font-size:.98rem}
#ogcard .fq{font-size:.76rem}
#ogcard .fpts{font-size:.76rem}
#ogcard .fbar{height:6px}
#ogcard .xscore{font-size:.98rem}
#ogcard .xscore small{font-size:.74rem}
#ogcard .foot{margin-top:auto;display:flex;justify-content:space-between;align-items:baseline;
  font-size:15px;color:var(--ink-soft);padding-top:16px;line-height:1.3;gap:24px}
#ogcard .foot b{color:var(--ink);font-weight:600}
"""

BUILD = """(o) => {
  document.querySelectorAll('#ogcard').forEach(n => n.remove());
  const mount = document.querySelector(o.mount);
  if (!mount) return {error: 'mount not found: ' + o.mount};
  const src = [...document.querySelectorAll('#xp .xrow')];
  if (src.length < o.rows) return {error: 'only ' + src.length + ' rows rendered'};
  const card = document.createElement('div');
  card.id = 'ogcard';
  card.innerHTML = '<p class="eb"></p><h1></h1><p class="dek"></p>';
  card.querySelector('.eb').textContent = o.eyebrow;
  card.querySelector('h1').textContent = o.title;
  card.querySelector('.dek').textContent = o.dek;
  const list = document.createElement('div');
  list.className = 'explorer';
  src.slice(0, o.rows).forEach(r => {
    const c = r.cloneNode(true);
    c.querySelectorAll('.xcap, .xnm button').forEach(n => n.remove());
    list.appendChild(c);
  });
  card.appendChild(list);
  const foot = document.createElement('div');
  foot.className = 'foot';
  const l = document.createElement('span'); l.textContent = o.footLeft;
  const r = document.createElement('span'); const b = document.createElement('b');
  b.textContent = o.footRight; r.appendChild(b);
  foot.append(l, r);
  card.appendChild(foot);
  mount.appendChild(card);
  return {names: [...card.querySelectorAll('.xrow .xnm')].map(e => e.textContent.trim())};
}"""


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    for k, v in DEFAULTS.items():
        ap.add_argument("--" + k.replace("_", "-"), default=v,
                        type=int if isinstance(v, int) else str)
    a = ap.parse_args()

    page = (ROOT / a.page).resolve()
    out = (ROOT / a.out).resolve()
    if not page.exists():
        sys.exit("no such page: %s" % page)

    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1200, "height": 630},
                        device_scale_factor=2, reduced_motion="reduce")
        pg.goto(page.as_uri(), wait_until="networkidle")
        pg.add_style_tag(content=CARD_CSS % {"title_font": a.title_font})
        res = pg.evaluate(BUILD, dict(mount=a.mount, rows=a.rows, eyebrow=a.eyebrow,
                                      title=a.title, dek=a.dek,
                                      footLeft=a.foot_left, footRight=a.foot_right))
        if res.get("error"):
            b.close()
            sys.exit("card build failed: " + res["error"])
        pg.locator("#ogcard").screenshot(path=str(out))
        b.close()

    print("wrote %s (%d KB)" % (out.name, out.stat().st_size // 1024))
    for i, n in enumerate(res["names"], 1):
        print("  %d. %s" % (i, n))


if __name__ == "__main__":
    main()
