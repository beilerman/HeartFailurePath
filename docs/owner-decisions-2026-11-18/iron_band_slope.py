"""
Change C5, third pass (controller recommendation 2026-11-18; owner instruction 2026-11-18: "implement the recommended changes and run them as one package").

IV iron has no outcome trial at LVEF 50 or above. Its preserved-EF rows are the reduced-EF figure carried by the slope the table itself shows for classes measured in more than one band:
the through-the-origin slope of the higher-band log relative risk on the reduced-EF log relative risk, by outcome, over ALL measured pairs.
  - A pair: a class's measured reduced-EF row (basis trial or meta_analysis, with an interval) and one of its measured higher-band rows (mildly reduced or preserved) of the same outcome.
  - Identical copies of one pair (the same class and numbers in both higher bands, or the nsMRA copy of the MRA pool) count once.
  - Weight 1 / se^2 of the higher-band row (se from the interval on the log scale); slope = sum(w xr xp) / sum(w xr^2); the slope's standard error is inflated by sqrt(Q / df) when Q exceeds its degrees of freedom.
Row: ln RR = slope x ln(source RR). Round 1 review (controller ruling 2026-11-19, E10): the slope is applied to a NEW class, so its uncertainty is the PREDICTION uncertainty, not the sampling error of the fitted slope:
  variance of the slope for a new class = se_slope^2 + tau2_slope, where tau2_slope is the DerSimonian-Laird between-class variance of the per-pair slopes (xp / xr, weight 1 / (se / xr)^2); the multiplier is the t quantile on (pairs - 2) degrees of freedom (Higgins 2009 prediction interval);
  half-width on the log scale = t x sqrt((slope se_source)^2 + (ln RR_source)^2 (se_slope^2 + tau2_slope)), and NEVER narrower than the source row's own half-width 1.96 x se_source (a carried effect cannot claim more precision than its source).
The source rows are fcm-reduced-death and fcm-reduced-hfhosp.
Usage: python3 docs/owner-decisions-2026-11-18/iron_band_slope.py [repository root]   (rewrites the two iron rows in data/outcomeEvidence.json; a check in scripts/measuredModelChecks.ts re-computes everything)
"""
import json, math, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
PATH = f'{ROOT}/data/outcomeEvidence.json'
rows = json.load(open(PATH))
by = {r['id']: r for r in rows}
lnse = lambda lo, hi: (math.log(hi) - math.log(lo)) / 3.92
meas = lambda r: r is not None and r['basis'] in ('trial', 'meta_analysis', 'subgroup') and r['ci_low'] is not None
T975 = {2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306}   # two-sided 97.5% t quantiles

def get(cls, outcome, band):
    x = [r for r in rows if r['drug_class'] == cls and r['outcome'] == outcome and r['ef_band'] == band and r.get('population_key') in (None, 'other')]   # the pooled three-trial beta-blocker row is the measured reduced-EF figure (E1)
    return x[0] if x else None

def slope(outcome):
    seen, pairs = set(), []
    for cls in sorted({r['drug_class'] for r in rows}):
        a = get(cls, outcome, 'reduced')
        if not meas(a): continue
        for band in ('mildly_reduced', 'preserved'):
            b = get(cls, outcome, band)
            if not meas(b): continue
            key = (round(math.log(a['rr']), 6), round(math.log(b['rr']), 6), round(lnse(b['ci_low'], b['ci_high']), 6))
            if key in seen: continue
            seen.add(key); pairs.append((cls, band, math.log(a['rr']), math.log(b['rr']), lnse(b['ci_low'], b['ci_high'])))
    w = [1 / p[4] ** 2 for p in pairs]
    sxx = sum(wi * p[2] ** 2 for wi, p in zip(w, pairs)); sxy = sum(wi * p[2] * p[3] for wi, p in zip(w, pairs))
    b = sxy / sxx; se = 1 / math.sqrt(sxx); Q = sum(wi * (p[3] - b * p[2]) ** 2 for wi, p in zip(w, pairs)); df = len(pairs) - 1
    se *= math.sqrt(max(1, Q / df))
    v = [(p[4] / p[2]) ** 2 for p in pairs]; wv = [1 / x for x in v]; C = sum(wv) - sum(x * x for x in wv) / sum(wv)
    tau2 = max(0.0, (Q - df) / C) if C > 0 else 0.0
    return b, se, pairs, tau2

report = []
for outcome, rid, src_id in (('all_cause_death', 'iviron-preserved-death', 'fcm-reduced-death'), ('hf_hospitalization', 'iviron-preserved-hfhosp', 'fcm-reduced-hfhosp')):
    b, se, pairs, tau2 = slope(outcome)
    s_, se_ = round(b, 3), round(se, 3)                 # stored rounded; the row is computed from the stored values so a check can reproduce it exactly
    t2_ = round(tau2, 4); tq = T975[len(pairs) - 2]
    pred = math.sqrt(se_ ** 2 + t2_)
    lo, hi = round(b - tq * pred, 3), round(b + tq * pred, 3)      # prediction interval of the slope for a new class
    src = by[src_id]; r = by[rid]
    se_src = lnse(src['ci_low'], src['ci_high'])
    ln = s_ * math.log(src['rr'])
    sd = math.sqrt((s_ * se_src) ** 2 + (math.log(src['rr'])) ** 2 * (se_ ** 2 + t2_))
    hw_model = tq * sd; hw_src = 1.96 * se_src; hw = max(hw_model, hw_src)
    old = (r['rr'], r['ci_low'], r['ci_high'], r['basis'])
    r.update(rr=round(math.exp(ln), 3), ci_low=round(math.exp(ln - hw), 3), ci_high=round(math.exp(ln + hw), 3), basis='extrapolated')
    r.pop('population_key', None)
    includes0 = lo <= 0 <= hi
    what = 'death' if outcome == 'all_cause_death' else 'hospitalization'
    r['extrapolation'] = (
        f'No outcome trial in LVEF 50 or above; FAIR-HFpEF stopped after 39 patients (6MWT +49 m, 95% CI 5-93; no event data; serious adverse events 5 vs 19, rate ratio 0.27 (0.07-0.96)). The {what} effect at LVEF 50 or above is the reduced-EF effect carried by the slope '
        f'the table shows for classes measured in more than one band: ln RR = {s_} x ln({src["rr"]}). The slope is {s_} from {len(pairs)} pairs of a measured reduced-EF row with a measured higher-band row (ACE inhibitor, ARB, beta-blocker, MRA, SGLT2 inhibitor, digoxin; identical copies counted once; '
        f'weight 1 / se^2 of the higher-band row). Because this applies another set of classes\' slope to a NEW class, the interval carries the PREDICTION uncertainty: slope standard error {se_} (inflated when Q exceeds its degrees of freedom) plus the between-class variance of the slopes {t2_}, with the t multiplier {tq} on {len(pairs) - 2} degrees of freedom. '
        f'The prediction interval of the slope for a new class is {lo} to {hi}, which {"includes 0" if includes0 else "does not include 0"}. The row\'s interval is the wider of that propagated interval and the source row\'s own interval ({src["ci_low"]} to {src["ci_high"]}), so it never claims more precision than its source. '
        f'It replaces the values of 2026-11-18 (death 0.986, 0.949 to 1.024; hospitalization 0.899, 0.825 to 0.980), whose intervals carried only the sampling error of the slope.')
    r['notes'] = ('Derived by iron_band_slope.py in docs/owner-decisions-2026-11-18 and re-computed by a check. The hospitalization interval no longer excludes 1 beyond what its source allows; the only preserved-EF randomized iron trial (FAIR-HFpEF, n=39) has no event data. Lowest confidence of the iron rows.')
    r['derivation'] = dict(kind='band_slope', source_row=src_id, slope=s_, slope_ci=[lo, hi], slope_se=se_, tau2_slope=t2_, t=tq, floor_applied=bool(hw_src > hw_model), outcome=outcome, pairs=[[p[0], p[1]] for p in pairs])
    report.append((rid, s_, (lo, hi), len(pairs), t2_, r['rr'], r['ci_low'], r['ci_high'], r['derivation']['floor_applied']))
open(PATH, 'w').write(json.dumps(rows, indent=1, ensure_ascii=True))
for x in report: print(x)
