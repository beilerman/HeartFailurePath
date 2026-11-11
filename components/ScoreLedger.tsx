import React from 'react';
import {
    DOMAIN_GROUPS, WEIGHT_PROFILE_META,
    type ScoreBreakdown, type ScoreBreakdownAdjustment, type ScoreBreakdownDomainLine,
} from '../services/engine/scoreModel';
import { DOMAIN_GOALS } from '../services/simulationService';
import { pct, num, signed, describeAdjustment, describeOverride, goalAfterEquals } from './scoreExplain';

// Renders ScoreBreakdown as a reconciling ledger, grouped like the engine's DOMAIN_GROUPS. Every
// number comes from the engine's breakdown (weights, points, adjustments) - nothing is restated here.

const Th: React.FC<{ children: React.ReactNode; right?: boolean }> = ({ children, right }) => (
    <th scope="col" className={`py-1.5 px-2 text-[10px] uppercase tracking-wider font-bold text-slate-600 ${right ? 'text-right' : 'text-left'}`}>{children}</th>
);

/** Thin 0-100 bar; the number beside it carries the information, the bar is only a visual aid. */
const ScoreBar: React.FC<{ score: number }> = ({ score }) => (
    <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100" aria-hidden="true">
        <div className="h-1.5 rounded-full bg-indigo-400" style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
    </div>
);

export const ScoreLedger: React.FC<{ breakdown?: ScoreBreakdown }> = ({ breakdown }) => {
    if (!breakdown) return null;
    const meta = WEIGHT_PROFILE_META[breakdown.weight_profile];
    const rawOverrides = (breakdown.overrides ?? []).filter(o => o.applies_to === 'raw_score');
    const finalOverrides = (breakdown.overrides ?? []).filter(o => o.applies_to === 'overall_score');
    const hasAdjustments = breakdown.adjustments.length > 0 || rawOverrides.length > 0;
    const byKey = new Map<string, ScoreBreakdownDomainLine>(breakdown.domains.map(d => [d.key, d]));
    const bonus = breakdown.adjustments.filter(a => a.points >= 0);
    const deductions = breakdown.adjustments.filter(a => a.points < 0);

    const adjustmentRow = (a: ScoreBreakdownAdjustment, i: number) => {
        const neg = a.points < 0;
        const { title, lines } = describeAdjustment(a);
        const isList = a.code === 'DANGEROUS_WARNINGS';
        return (
            <tr key={`${a.code}-${i}`}>
                <th scope="row" colSpan={3} className="py-1.5 px-2 text-left font-medium text-slate-700 align-top">
                    {title}
                    {a.items && a.items.length > 0 && (
                        <ul className="mt-1 list-disc list-inside text-xs font-normal text-slate-600 space-y-0.5">
                            {a.items.map((it, j) => (
                                <li key={j}>{it.med} — {it.feature} — {signed(it.points)} before scaling</li>
                            ))}
                        </ul>
                    )}
                    {lines.length > 0 && (isList ? (
                        <ul className="mt-1 list-disc list-inside text-xs font-normal text-slate-600 space-y-0.5">
                            {lines.map((l, j) => <li key={j}>{l}</li>)}
                        </ul>
                    ) : lines.map((l, j) => <div key={j} className="text-xs font-normal text-slate-600">{l}</div>))}
                </th>
                <td className={`py-1.5 px-2 text-right tabular-nums font-bold align-top ${neg ? 'text-red-700' : 'text-emerald-700'}`}>
                    <span aria-label={neg ? 'deduction' : 'bonus'}>{neg ? '▼ ' : '▲ '}{signed(a.points)}</span>
                </td>
            </tr>
        );
    };

    return (
        <section aria-labelledby="score-ledger-heading" className="space-y-2">
            <h4 id="score-ledger-heading" className="text-sm font-bold text-slate-800">How this score was calculated</h4>
            <p className="text-xs text-slate-600 leading-snug">
                <span className="font-bold">Weighting: {meta.label}.</span> {meta.description} Each of the eight factors is scored 0–100, multiplied by its weight, and added up. A few named adjustments are then applied.
            </p>
            <div className="overflow-x-auto rounded border border-slate-200">
                <table className="w-full text-sm min-w-[18.5rem]">
                    <caption className="sr-only">Overall score ledger: factor scores, weights and points by group, then adjustments and the final score</caption>
                    <thead className="bg-slate-50 border-b border-slate-200">
                        <tr><Th>Factor</Th><Th right>Score</Th><Th right>Weight</Th><Th right>Points</Th></tr>
                    </thead>
                    {DOMAIN_GROUPS.map(g => {
                        const lines = g.domains.map(k => byKey.get(k)).filter((d): d is ScoreBreakdownDomainLine => !!d);
                        const wSum = lines.reduce((s, d) => s + d.weight, 0);
                        const pSum = lines.reduce((s, d) => s + d.contribution, 0);
                        return (
                            <tbody key={g.key} className="divide-y divide-slate-100 border-t border-slate-200">
                                <tr className="bg-slate-50">
                                    <th scope="colgroup" colSpan={4} className="py-1.5 px-2 text-left text-xs font-bold text-slate-700">{g.label}</th>
                                </tr>
                                {lines.map(d => (
                                    <tr key={d.key}>
                                        <th scope="row" className="py-1.5 px-2 text-left font-medium text-slate-700 align-top">
                                            {d.label}
                                            <div className="text-[11px] font-normal text-slate-500 leading-snug">100 = {goalAfterEquals(DOMAIN_GOALS[d.key])}</div>
                                            {d.detail && <div className="text-[11px] font-normal text-amber-800">{d.detail}</div>}
                                            <ScoreBar score={d.score} />
                                        </th>
                                        <td className="py-1.5 px-2 text-right tabular-nums align-top">{num(d.score)}</td>
                                        <td className="py-1.5 px-2 text-right tabular-nums text-slate-600 align-top">{pct(d.weight)}</td>
                                        <td className="py-1.5 px-2 text-right tabular-nums align-top">{num(d.contribution)}</td>
                                    </tr>
                                ))}
                                <tr className="text-slate-700 font-semibold">
                                    <th scope="row" className="py-1 px-2 text-left text-xs">Subtotal, {g.label.toLowerCase()}</th>
                                    <td />
                                    <td className="py-1 px-2 text-right tabular-nums text-xs">{pct(wSum)}</td>
                                    <td className="py-1 px-2 text-right tabular-nums text-xs">{num(pSum)}</td>
                                </tr>
                            </tbody>
                        );
                    })}
                    <tbody className="border-t border-slate-200">
                        <tr className="bg-slate-100 font-bold">
                            <th scope="row" className="py-1.5 px-2 text-left">Weighted total of the eight factors</th>
                            <td />
                            <td className="py-1.5 px-2 text-right tabular-nums">{pct(breakdown.domains.reduce((s, d) => s + d.weight, 0))}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{num(breakdown.weighted_subtotal)}</td>
                        </tr>
                    </tbody>
                    <tbody className="divide-y divide-slate-100 border-t border-slate-200">
                        <tr className="bg-slate-50">
                            <th scope="colgroup" colSpan={4} className="py-1.5 px-2 text-left text-xs font-bold text-slate-700">Adjustments</th>
                        </tr>
                        {!hasAdjustments && (
                            <tr><th scope="row" colSpan={3} className="py-1.5 px-2 text-left font-normal text-slate-600">None apply to this option</th><td className="py-1.5 px-2 text-right tabular-nums">{num(0)}</td></tr>
                        )}
                        {bonus.map(adjustmentRow)}
                        {deductions.map(adjustmentRow)}
                        {rawOverrides.map((o, i) => {
                            const d = describeOverride(o);
                            return (
                                <tr key={`${o.code}-${i}`} className="bg-red-50">
                                    <th scope="row" colSpan={3} className="py-1.5 px-2 text-left font-medium text-red-800 align-top">
                                        {d.title}
                                        {d.detail && <div className="text-xs font-normal">{d.detail}</div>}
                                    </th>
                                    <td className="py-1.5 px-2 text-right tabular-nums font-bold text-red-800 align-top">
                                        {'▼ '}{signed(o.after - o.before)}
                                        <div className="text-[10px] font-normal">{num(o.before)} {'→'} {num(o.after)}</div>
                                    </td>
                                </tr>
                            );
                        })}
                        {hasAdjustments && (
                            <tr className="bg-slate-100 font-bold">
                                <th scope="row" colSpan={3} className="py-1.5 px-2 text-left">Score after adjustments</th>
                                <td className="py-1.5 px-2 text-right tabular-nums">{num(breakdown.raw_score)}</td>
                            </tr>
                        )}
                        {finalOverrides.map((o, i) => {
                            const d = describeOverride(o);
                            return (
                                <tr key={`${o.code}-${i}`} className="bg-amber-50">
                                    <th scope="row" colSpan={3} className="py-1.5 px-2 text-left font-medium text-amber-900">
                                        {d.title}
                                        <div className="text-xs font-normal">{num(o.before)} {'→'} {num(o.after)}</div>
                                    </th>
                                    <td className="py-1.5 px-2 text-right tabular-nums font-bold text-amber-900">{signed(o.after - o.before)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot>
                        <tr className="bg-indigo-50 font-black text-indigo-700 border-t-2 border-indigo-200">
                            <th scope="row" colSpan={3} className="py-2 px-2 text-left">Final score</th>
                            <td className="py-2 px-2 text-right tabular-nums">{breakdown.overall_score}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <p className="text-[11px] text-slate-500 leading-snug">
                Points are each factor score multiplied by its weight. Values are shown to one decimal; the engine carries full precision, so displayed lines may differ from the total by a rounding digit.
            </p>
        </section>
    );
};
