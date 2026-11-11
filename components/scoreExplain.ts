import type { ScoredRegimen } from '../types';
import {
    DOMAIN_KEYS, DOMAIN_LABELS, SCORE_ADJUSTMENTS,
    type ScoreBreakdown, type ScoreBreakdownAdjustment, type ScoreBreakdownOverride, type ScoreDomainKey,
} from '../services/engine/scoreModel';

// Plain-English wording and comparison arithmetic for the score ledger. Every number comes from the
// engine's ScoreBreakdown or SCORE_ADJUSTMENTS; this module only phrases them.

export const pct = (w: number) => `${Math.round(w * 1000) / 10}%`;
export const num = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
export const signed = (n: number) => `${n >= 0 ? '+' : '−'}${num(Math.abs(n))}`;

const T = SCORE_ADJUSTMENTS;

/** Plain wording for one adjustment line: a title and optional bullet lines. */
export function describeAdjustment(a: ScoreBreakdownAdjustment): { title: string; lines: string[] } {
    switch (a.code) {
        case T.SPECIAL_FEATURES.code:
            return {
                title: 'Patient-specific evidence bonus',
                lines: [`Credit for medication features with trial evidence that applies to this patient. Scaled to the size of the regimen and limited to between ${signed(T.SPECIAL_FEATURES.min)} and ${signed(T.SPECIAL_FEATURES.max)}.`],
            };
        case T.VOLUME_DEPLETION_DEESCALATION.code:
            return { title: 'Bonus for reducing diuretics in a volume-depleted patient', lines: [] };
        case T.PROJECTED_SBP_LT_90.code:
            return { title: `Safety deduction: projected systolic BP below ${T.PROJECTED_SBP_LT_90.threshold}`, lines: a.detail ? [a.detail.replace('projected SBP', 'Projected systolic BP')] : [] };
        case T.PROJECTED_SBP_LT_95.code:
            return { title: `Safety deduction: projected systolic BP below ${T.PROJECTED_SBP_LT_95.threshold}`, lines: a.detail ? [a.detail.replace('projected SBP', 'Projected systolic BP')] : [] };
        case T.PROJECTED_HR_LT_50.code:
            return { title: `Safety deduction: projected heart rate below ${T.PROJECTED_HR_LT_50.threshold}`, lines: a.detail ? [a.detail.replace('projected HR', 'Projected heart rate')] : [] };
        case T.PROJECTED_K_GT_5_5.code:
            return { title: `Safety deduction: projected potassium above ${T.PROJECTED_K_GT_5_5.threshold}`, lines: a.detail ? [a.detail.replace('projected K+', 'Projected potassium')] : [] };
        case T.DANGEROUS_WARNINGS.code: {
            const warnings = a.detail ? a.detail.split(' | ') : [];
            return {
                title: `Safety deduction: ${warnings.length || 'residual'} unresolved safety warning${warnings.length === 1 ? '' : 's'} (${signed(T.DANGEROUS_WARNINGS.perUnit)} each)`,
                lines: warnings,
            };
        }
        case T.UNKNOWN_POTASSIUM.code:
            return { title: 'Safety deduction: potassium not entered while starting or increasing a RAAS inhibitor or MRA', lines: [] };
        case T.UNKNOWN_RENAL.code:
            return { title: 'Safety deduction: kidney function not entered while starting or increasing a RAAS inhibitor, MRA or SGLT2 inhibitor', lines: [] };
        default:
            return { title: a.label, lines: a.detail ? [a.detail] : [] };
    }
}

/** Plain wording for an override line (applies to the running score or to the displayed score). */
export function describeOverride(o: ScoreBreakdownOverride): { title: string; detail?: string } {
    switch (o.code) {
        case T.PROJECTED_SBP_LT_85.code:
            return { title: `Projected systolic BP below ${T.PROJECTED_SBP_LT_85.threshold}: score set to zero`, detail: o.detail?.replace('projected SBP', 'Projected systolic BP') };
        case T.SCORE_CLAMP.code:
            return { title: `Score limited to the ${T.SCORE_CLAMP.min}–${T.SCORE_CLAMP.max} range` };
        case T.LOW_OUTPUT_CAP.code:
            return { title: `Low-output state: displayed score capped at ${T.LOW_OUTPUT_CAP.max}` };
        default:
            return { title: o.label, detail: o.detail };
    }
}

export interface ScoreDelta {
    key: string;
    label: string;
    /** Difference in points (this option minus the comparison option). */
    delta: number;
    kind: 'factor' | 'adjustment';
}

/** Points an option gets from adjustments of one code, including raw-score overrides (SBP < 85). */
function adjustmentTotals(b: ScoreBreakdown): Map<string, { points: number; adj?: ScoreBreakdownAdjustment }> {
    const m = new Map<string, { points: number; adj?: ScoreBreakdownAdjustment }>();
    for (const a of b.adjustments) {
        const cur = m.get(a.code);
        m.set(a.code, { points: (cur?.points ?? 0) + a.points, adj: cur?.adj ?? a });
    }
    for (const o of b.overrides ?? []) {
        if (o.applies_to !== 'raw_score') continue;
        const cur = m.get(o.code);
        m.set(o.code, { points: (cur?.points ?? 0) + (o.after - o.before), adj: cur?.adj });
    }
    return m;
}

const adjustmentName = (code: string, adj?: ScoreBreakdownAdjustment): string => {
    if (code === T.SPECIAL_FEATURES.code) return 'patient-specific evidence bonus';
    if (code === T.VOLUME_DEPLETION_DEESCALATION.code) return 'diuretic reduction bonus';
    if (code === T.PROJECTED_SBP_LT_85.code) return `disqualifying projected systolic BP below ${T.PROJECTED_SBP_LT_85.threshold}`;
    if (adj) {
        const t = describeAdjustment(adj).title.replace(/^Safety deduction: /, '');
        const base = `safety deduction (${t.replace(/ \(.* each\)$/, '')})`;
        return base;
    }
    return code.toLowerCase().replace(/_/g, ' ');
};

/**
 * Every factor and adjustment that differs between an option and the leader, in points. The sum of
 * all returned deltas equals option.raw_score - leader.raw_score (the ranking value before display
 * limits), because that is how the engine builds raw_score.
 */
export function compareBreakdowns(self: ScoreBreakdown, leader: ScoreBreakdown): ScoreDelta[] {
    const out: ScoreDelta[] = [];
    for (const key of DOMAIN_KEYS) {
        const a = self.domains.find(d => d.key === key);
        const b = leader.domains.find(d => d.key === key);
        if (!a || !b) continue;
        out.push({ key, label: DOMAIN_LABELS[key as ScoreDomainKey], delta: a.contribution - b.contribution, kind: 'factor' });
    }
    const sa = adjustmentTotals(self);
    const sl = adjustmentTotals(leader);
    for (const code of new Set([...sa.keys(), ...sl.keys()])) {
        const delta = (sa.get(code)?.points ?? 0) - (sl.get(code)?.points ?? 0);
        out.push({ key: code, label: adjustmentName(code, sa.get(code)?.adj ?? sl.get(code)?.adj), delta, kind: 'adjustment' });
    }
    return out;
}

const EPS = 0.05; // below this a difference prints as 0.0

/** The `n` largest drops and gains (by size), ignoring differences that would print as 0.0. */
export function topDeltas(deltas: ScoreDelta[], n: number): { lower: ScoreDelta[]; higher: ScoreDelta[] } {
    const lower = deltas.filter(d => d.delta <= -EPS).sort((a, b) => a.delta - b.delta).slice(0, n);
    const higher = deltas.filter(d => d.delta >= EPS).sort((a, b) => b.delta - a.delta).slice(0, n);
    return { lower, higher };
}

export const TIE_RULE_TEXT =
    'When two options show the same whole-number score, the one covering more of the indicated therapy is listed first; if that is also equal, the one with the higher unrounded score; then the cheaper one.';

/** One sentence on how a tie against the leader was settled, or null when the displayed scores differ. */
export function tieSentence(self: ScoredRegimen, leader: ScoredRegimen, leaderRank: number): string | null {
    if (self.overall_score !== leader.overall_score) return null;
    const sc = Math.round((self.gdmt_completeness ?? 0) * 100);
    const lc = Math.round((leader.gdmt_completeness ?? 0) * 100);
    return `Option ${leaderRank} shows the same score (${leader.overall_score}). ${TIE_RULE_TEXT} Here: therapy coverage ${sc}% vs ${lc}%, unrounded score ${num(self.raw_score ?? self.overall_score)} vs ${num(leader.raw_score ?? leader.overall_score)}, monthly cost $${self.cost} vs $${leader.cost}.`;
}

/** Lowercase the first letter of a goal sentence, unless it starts an acronym (NYHA, NT-proBNP). */
export const goalAfterEquals = (s: string) => s.replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase());
