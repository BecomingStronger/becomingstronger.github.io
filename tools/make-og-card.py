#!/usr/bin/env python3
"""Render the link-preview card for the cause prioritization page.

The card is the top three rows of the per-problem breakdown, cloned from the
live page so it cannot drift from the ranking. Re-run after any score change:

    python3 tools/make-og-card.py

Writes og-card-evidence.png (1200x630) next to the page.
"""
import pathlib, sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = ROOT / "kc-cause-prioritization.html"
OUT  = ROOT / "og-card-evidence.png"

CARD_CSS = """
#ogcard{position:fixed;left:0;top:0;width:1200px;height:630px;z-index:9999;
  background:var(--paper);padding:44px 48px;box-sizing:border-box;
  display:flex;flex-direction:column;gap:0}
#ogcard .eb{font-size:15px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;
  color:var(--leaf);margin:0 0 10px}
#ogcard h1{font-family:"Raleway",sans-serif;font-weight:600;font-size:40px;line-height:1.12;
  letter-spacing:-.015em;margin:0 0 6px;color:var(--ink);text-wrap:balance;max-width:1010px}
#ogcard .dek{font-size:17px;color:var(--ink-soft);margin:0 0 20px}
#ogcard .explorer{border:1px solid var(--line-strong)}
#ogcard .xrow{padding:13px 16px}
#ogcard .xtop{grid-template-columns:40px minmax(150px,.85fr) minmax(520px,1.9fr) 84px;gap:16px}
#ogcard .xrank{font-size:1.2rem;padding:5px 0}
#ogcard .xnm{font-size:1.13rem;font-weight:600}
#ogcard .fl{font-size:.72rem}
#ogcard .fv{font-size:.98rem}
#ogcard .fq{font-size:.76rem}
#ogcard .fpts{font-size:.76rem}
#ogcard .fbar{height:6px}
#ogcard .xscore{font-size:.98rem}
#ogcard .xscore small{font-size:.74rem}
#ogcard .foot{margin-top:auto;display:flex;justify-content:space-between;align-items:baseline;
  font-size:15px;color:var(--ink-soft);padding-top:16px}
#ogcard .foot b{color:var(--ink);font-weight:600}
"""

BUILD = """(rows) => {
  document.querySelectorAll('#ogcard').forEach(n => n.remove());
  const card = document.createElement('div');
  card.id = 'ogcard';
  const list = document.createElement('div');
  list.className = 'explorer';
  [...document.querySelectorAll('#xp .xrow')].slice(0, rows).forEach(r => {
    const c = r.cloneNode(true);
    c.querySelectorAll('.xcap, .xnm button').forEach(n => n.remove());
    list.appendChild(c);
  });
  card.innerHTML =
    '<p class="eb">Becoming Stronger</p>' +
    '<h1>Where would a marginal dollar do the most good in Kansas City?</h1>' +
    '<p class="dek">Fifteen problems scored on impact, tractability and neglectedness. The top three:</p>';
  card.appendChild(list);
  const foot = document.createElement('div');
  foot.className = 'foot';
  foot.innerHTML = '<span>Burden model, cost-effectiveness ladder and funding map, with 10,000-draw rank intervals</span>' +
                   '<span><b>69 cited sources</b></span>';
  card.appendChild(foot);
  document.body.appendChild(card);
  return true;
}"""

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1200, "height": 630},
                        device_scale_factor=2, reduced_motion="reduce")
        pg.goto(PAGE.as_uri(), wait_until="networkidle")
        pg.add_style_tag(content=CARD_CSS)
        pg.evaluate(BUILD, 3)
        names = pg.eval_on_selector_all(
            "#ogcard .xrow .xnm", "els => els.map(e => e.textContent.trim())")
        pg.locator("#ogcard").screenshot(path=str(OUT))
        b.close()
    print("wrote %s" % OUT.name)
    for i, n in enumerate(names, 1):
        print("  %d. %s" % (i, n))
    if len(names) != 3:
        sys.exit("expected 3 rows, got %d" % len(names))

if __name__ == "__main__":
    main()
