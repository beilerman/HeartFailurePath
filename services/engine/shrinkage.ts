/**
 * Precision-weighted estimates (ENGINE POLICY, statistical method; controller ruling 2026-11-16; awaiting the owner, first-principles README section 10 item 6).
 *
 * Why: ranking used every evidence row's point estimate at face value, however small the trials (loop-diuretic death 0.24 from 202 patients; beta-blocker at LVEF 41-49
 * 0.59 with interval 0.34-1.03). One uniform rule, no per-row exception: the value used is the POSTERIOR MEAN under a prior centred on no effect,
 *
 *     x_used  = B x x_published          x = ln(relative risk) for outcomes, KCCQ points for symptoms
 *     B       = tau2 / (tau2 + se^2)     se = (ci_high - ci_low) / 3.92 on the same scale (log scale for relative risks)
 *     se_used = sqrt(B) x se             (the posterior standard error)
 *
 * A precisely measured row barely moves (B near 1); a row from tiny trials is pulled toward no effect (B small). tau2 is the between-row variance of true effects,
 * COMPUTED from the table, never typed, with the DerSimonian-Laird moment estimator centred on no effect: over rows whose basis is `trial` or `meta_analysis` and that have an
 * interval, after counting an identical (value, interval) copied across bands or drugs once,
 *     w_i = 1 / se_i^2,  Q = sum(w_i x_i^2),  C = sum(w_i) - sum(w_i^2) / sum(w_i),  tau2 = max(0, (Q - k) / C)        (k = number of distinct rows)
 * WHY WEIGHTED: a row's influence on the prior should follow its precision. The earlier unweighted form (mean(x^2) - mean(se^2)) let two very imprecise rows (the loop-diuretic
 * figures from 202 and 169 patients) set the prior for all 38 rows. No row is excluded. A row with a value but no interval uses the MEDIAN se of the rows that have one and is flagged
 * `interval_imputed`. A row with no effect (value 0) stays 0. Zero width (se 0) gives B = 1: unchanged.
 */
export interface Shrunk { used: number; se_used: number; B: number; imputed: boolean; se: number }

export const shrinkB = (tau2: number, se: number): number => (se <= 0 ? 1 : tau2 / (tau2 + se * se));

export function tau2From(items: { x: number; se: number }[]): number {
    const rows = items.filter(i => i.se > 0);          // a zero-width row has infinite precision and carries no between-row information
    if (rows.length === 0) return 0;
    const w = rows.map(i => 1 / (i.se * i.se));
    const sw = w.reduce((a, b) => a + b, 0), sw2 = w.reduce((a, b) => a + b * b, 0);
    const Q = rows.reduce((a, i, j) => a + w[j] * i.x * i.x, 0);
    const C = sw - sw2 / sw;
    return C > 0 ? Math.max(0, (Q - rows.length) / C) : 0;
}

export function median(xs: number[]): number {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** x with its standard error (null = no interval): the shrunk value. */
export function shrinkValue(x: number, se: number | null, tau2: number, imputedSe: number): Shrunk {
    const imputed = se === null;
    const s = se === null ? imputedSe : se;
    const B = shrinkB(tau2, s);
    return { used: B * x, se_used: Math.sqrt(B) * s, B, imputed, se: s };
}
