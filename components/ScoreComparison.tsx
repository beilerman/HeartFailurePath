import React from 'react';
import type { ScoredRegimen } from '../types';
import { compareBreakdowns, topDeltas, tieSentence, signed, FOUNDATIONAL_ORDER_NOTE, type ScoreDelta } from './scoreExplain';

// "Why this ranked lower": the per-factor and adjustment differences between an option and option 1,
// computed from the two score breakdowns. Deltas are in score points (weight x factor score).

interface Props {
    regimen: ScoredRegimen;
    leader: ScoredRegimen;
    rank: number;
    leaderRank?: number;
    /** The foundational ranking mode is applied: the order is not the score order, so say so instead of the score tie rule. */
    foundationalOrder?: boolean;
}

const fmt = (d: ScoreDelta) => `${d.label} ${signed(d.delta)}`;

function useComparison(regimen: ScoredRegimen, leader: ScoredRegimen, n: number) {
    if (!regimen.score_breakdown || !leader.score_breakdown || regimen === leader) return null;
    const all = compareBreakdowns(regimen.score_breakdown, leader.score_breakdown);
    return { all, ...topDeltas(all, n) };
}

/** One-line version for inside the card's expandable section. */
export const ScoreComparisonLine: React.FC<Props> = ({ regimen, leader, rank, leaderRank = 1, foundationalOrder = false }) => {
    const c = useComparison(regimen, leader, 2);
    if (!c) return null;
    const tie = foundationalOrder ? null : tieSentence(regimen, leader, leaderRank);
    const gap = leader.overall_score - regimen.overall_score;
    return (
        <div className="col-span-2 text-xs text-slate-600 leading-snug space-y-1" data-testid={`comparison-line-${rank}`}>
            <p>
                <span className="font-bold text-slate-700">Compared with option {leaderRank}:</span>{' '}
                {c.lower.length === 0 && c.higher.length === 0
                    ? 'no factor differs by a tenth of a point or more.'
                    : <>
                        {c.lower.length > 0 && <>lower on {c.lower.map(fmt).join(' · ')}</>}
                        {c.lower.length > 0 && c.higher.length > 0 && '; '}
                        {c.higher.length > 0 && <>higher on {c.higher.map(fmt).join(' · ')}</>}
                        {'.'}
                    </>}
                {gap > 0 && <> Overall {gap} point{gap === 1 ? '' : 's'} lower.</>}
            </p>
            {tie && <p className="text-slate-500">{tie}</p>}
            {foundationalOrder && <p className="text-slate-500">{FOUNDATIONAL_ORDER_NOTE}</p>}
        </div>
    );
};

/** Fuller list for the ledger modal. */
export const ScoreComparisonDetail: React.FC<Props> = ({ regimen, leader, rank, leaderRank = 1, foundationalOrder = false }) => {
    const c = useComparison(regimen, leader, 3);
    if (!c) return null;
    const tie = foundationalOrder ? null : tieSentence(regimen, leader, leaderRank);
    const total = c.all.reduce((s, d) => s + d.delta, 0);
    const Group = ({ title, items }: { title: string; items: ScoreDelta[] }) => items.length === 0 ? null : (
        <div>
            <h5 className="text-xs font-bold text-slate-600">{title}</h5>
            <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
                {items.map(d => (
                    <li key={d.key} className="flex justify-between gap-3">
                        <span>{d.label}</span>
                        <span className="tabular-nums font-semibold">{d.delta < 0 ? '▼ ' : '▲ '}{signed(d.delta)}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
    return (
        <section aria-labelledby={`why-lower-${rank}`} className="space-y-2 mt-5 border-t border-slate-200 pt-4">
            <h4 id={`why-lower-${rank}`} className="text-sm font-bold text-slate-800">Why option {rank} ranked below option {leaderRank}</h4>
            <p className="text-xs text-slate-500 leading-snug">
                Largest differences in score points versus option {leaderRank}.{Math.abs(total) >= 0.05 && <> All differences together: {signed(total)} points before display limits.</>}
            </p>
            <Group title={`Lower than option ${leaderRank}`} items={c.lower} />
            <Group title={`Higher than option ${leaderRank}`} items={c.higher} />
            {c.lower.length === 0 && c.higher.length === 0 && <p className="text-sm text-slate-600">No factor differs by a tenth of a point or more.</p>}
            {tie && <p className="text-xs text-slate-600 leading-snug bg-slate-50 border border-slate-200 rounded p-2">{tie}</p>}
            {foundationalOrder && <p className="text-xs text-slate-600 leading-snug bg-slate-50 border border-slate-200 rounded p-2">{FOUNDATIONAL_ORDER_NOTE}</p>}
        </section>
    );
};
