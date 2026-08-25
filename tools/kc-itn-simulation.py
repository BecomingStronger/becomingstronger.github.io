#!/usr/bin/env python3
"""Monte Carlo for the Kansas City ITN cause prioritization.

Reproduces every rank, rank interval, and P(top 3) published on
https://becomingstronger.github.io/kc-cause-prioritization.html
(stdlib only; deterministic with the fixed seed).

METHOD
- Each of the 15 problems carries four uncertain quantities, each expressed
  as (low, point, high):
    I    annual DALYs (thousands), the 80% CI from the burden model
         (the Impact section of the page above);
    T    tractability score 0-10 (log-scale anchor: $500/DALY ~ 9,
         $5K ~ 7, $50K ~ 5, nothing proven ~ 1-2, adjusted for evidence
         strength, Missouri legal feasibility, and KC precedent);
    N    neglectedness score 0-10, scored at the prevention margin
         (local prevention dollars per DALY, inverted);
    M    marginal DALYs averted per additional $10M/yr, synthesized from
         verified intervention cost-effectiveness x feasibility x
         room-to-scale x crowding.
- Every quantity is drawn from a TRIANGULAR distribution over its
  (low, point, high). Triangular is the honest choice for elicited ranges:
  it respects the bounds and the mode without inventing tail structure the
  evidence cannot support.
- 10,000 draws. In each draw, all 15 problems are ranked twice:
    View A: by the drawn M (marginal DALYs per $10M) -- the headline,
            because it integrates all three ITN factors in one
            decision-relevant unit;
    View B: by the factor product log10(I x 1000) + T/2 + N/2 -- the
            classic ITN log-sum (equivalent to multiplying I x 10^(T/2)
            x 10^(N/2)), used by the page's interactive explorer.
- Output per problem: median rank, 10th-90th percentile rank band, and
  P(top 3) under View A.

KNOWN LIMITATIONS (stated in the article as well)
- Draws are independent across problems and factors. A systematic bias in
  the $/QALY anchoring would shift many T scores together; correlated
  draws would widen the true rank bands.
- The M ranges are themselves a synthesis judgment over the verified
  component evidence, not a resampling of the components.
- T and N are structured judgment over verified evidence, not measured
  constants; that is exactly why rank intervals, not point ranks, are the
  published result.
"""

import math
import random

random.seed(42)  # published numbers use this seed

# name, I=(pt,lo,hi) kDALYs/yr, T=(lo,pt,hi), N=(lo,pt,hi), M=(lo,pt,hi)
PROBLEMS = [
    ("Tobacco control (chronic respiratory lever)", (34, 28, 41), (5.5, 6.5, 7.5), (7.5, 8.5, 9.5), (1200, 2800, 6000)),
    ("Drug use & overdose",                         (41, 32, 51), (7.0, 8.0, 8.8), (5.0, 6.0, 7.0), (700, 1800, 4000)),
    ("Elderly falls",                               (13, 11, 17), (6.0, 7.0, 8.0), (8.5, 9.5, 10.0), (500, 1200, 2600)),
    ("Cardiovascular / hypertension",               (99, 84, 116), (5.5, 6.5, 7.5), (5.0, 6.0, 7.0), (400, 900, 2000)),
    ("Road traffic injuries",                       (16, 13, 19), (4.5, 6.0, 7.0), (5.0, 6.0, 7.0), (200, 700, 1800)),
    ("Infant & maternal",                           (15, 12, 19), (5.0, 6.0, 7.0), (7.0, 8.0, 9.0), (250, 650, 1300)),
    ("Cancer (screening + tobacco spillover)",      (77, 66, 89), (4.5, 5.5, 6.5), (3.0, 4.0, 5.0), (150, 400, 900)),
    ("Mental illness (collaborative care)",         (53, 43, 64), (5.0, 6.0, 7.0), (4.0, 5.0, 6.0), (150, 320, 600)),
    ("Diabetes + kidney",                           (43, 35, 52), (4.5, 5.5, 6.5), (2.5, 3.5, 4.5), (100, 300, 700)),
    ("Interpersonal violence",                      (12, 10, 15), (2.5, 4.0, 5.5), (4.0, 5.0, 6.0), (0, 250, 1200)),
    ("Alcohol (narrow AUD lever)",                  (9, 7, 11),   (2.5, 3.5, 4.5), (6.5, 7.5, 8.5), (60, 180, 500)),
    ("Suicide & self-harm",                         (15, 12, 18), (3.0, 4.0, 5.0), (4.0, 5.0, 6.0), (50, 150, 400)),
    ("Digestive / cirrhosis",                       (25, 21, 31), (3.0, 4.0, 5.0), (5.0, 6.0, 7.0), (50, 150, 450)),
    ("Musculoskeletal",                             (68, 53, 83), (1.2, 2.0, 3.0), (8.0, 9.0, 9.8), (20, 100, 300)),
    ("Neurological",                                (47, 39, 56), (1.5, 2.5, 3.5), (5.0, 6.0, 7.0), (20, 80, 250)),
]

DRAWS = 10_000


def tri(lo, pt, hi):
    return random.triangular(lo, hi, pt)


def main():
    ranks_a = {p[0]: [] for p in PROBLEMS}
    ranks_b = {p[0]: [] for p in PROBLEMS}
    top3_a = {p[0]: 0 for p in PROBLEMS}

    for _ in range(DRAWS):
        # View A: marginal DALYs per $10M/yr (bigger is better)
        draw_a = [(name, tri(*m)) for name, i, t, n, m in PROBLEMS]
        # View B: log factor product; I in raw DALYs, T and N half-weighted
        draw_b = [
            (name, math.log10(max(tri(i[1], i[0], i[2]), 1) * 1000)
             + tri(*t) / 2 + tri(*n) / 2)
            for name, i, t, n, m in PROBLEMS
        ]
        for rank, (name, _) in enumerate(sorted(draw_a, key=lambda x: -x[1]), 1):
            ranks_a[name].append(rank)
            top3_a[name] += rank <= 3
        for rank, (name, _) in enumerate(sorted(draw_b, key=lambda x: -x[1]), 1):
            ranks_b[name].append(rank)

    def q(xs, p):
        return sorted(xs)[int(p * len(xs))]

    print(f"{'Problem':<46}{'medA':>5}{'A 10-90%':>10}{'P(top3)':>8}{'medB':>6}{'B 10-90%':>10}")
    for p in sorted(PROBLEMS, key=lambda p: q(ranks_a[p[0]], 0.5)):
        n = p[0]
        ra, rb = ranks_a[n], ranks_b[n]
        print(f"{n:<46}{q(ra, .5):>5}{str(q(ra, .1)) + '-' + str(q(ra, .9)):>10}"
              f"{top3_a[n] / DRAWS:>8.0%}{q(rb, .5):>6}"
              f"{str(q(rb, .1)) + '-' + str(q(rb, .9)):>10}")


if __name__ == "__main__":
    main()
