import React from 'react';
import type { ScoreBreakdown } from '../services/engine/scoreModel';

// Renders ScoreBreakdown as a reconciling ledger. Every number comes from the engine's
// breakdown (weights, points, overrides) — nothing is restated here.

const pct = (w: number) => `${Math.round(w * 1000) / 10}%`;
const num = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${num(Math.abs(n))}`;

const Th: React.FC<{ children: React.ReactNode; right?: boolean }> = ({ children, right }) => (
    <th scope="col" className={`py-1.5 px-2 text-[10px] uppercase tracking-wider font-bold text-slate-500 ${right ? 'text-right' : 'text-left'}`}>{children}</th>
);

export const ScoreLedger: React.FC<{ breakdown?: ScoreBreakdown }> = ({ breakdown }) => {
    if (!breakdown) return null;
    const rawOverrides = (breakdown.overrides ?? []).filter(o => o.applies_to === 'raw_score');
    const finalOverrides = (breakdown.overrides ?? []).filter(o => o.applies_to === 'overall_score');

    return (
        <section aria-labelledby="score-ledger-heading" className="space-y-2">
            <h4 id="score-ledger-heading" className="text-sm font-bold text-slate-800">How this score was calculated</h4>
            <div className="overflow-x-auto rounded border border-slate-200">
                <table className="w-full text-sm">
                    <caption className="sr-only">Overall score ledger: domain scores, weights, adjustments and final score</caption>
                    <thead className="bg-slate-50 border-b border-slate-200">
                        <tr><Th>Factor</Th><Th right>Score</Th><Th right>Weight</Th><Th right>Points</Th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {breakdown.domains.map(d => (
                            <tr key={d.key}>
                                <th scope="row" className="py-1.5 px-2 text-left font-medium text-slate-700">{d.label}</th>
                                <td className="py-1.5 px-2 text-right tabular-nums">{num(d.score)}</td>
                                <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">{pct(d.weight)}</td>
                                <td className="py-1.5 px-2 text-right tabular-nums">{num(d.contribution)}</td>
                            </tr>
                        ))}
                        <tr className="bg-slate-50 font-bold">
                            <th scope="row" colSpan={3} className="py-1.5 px-2 text-left">Weighted subtotal</th>
                            <td className="py-1.5 px-2 text-right tabular-nums">{num(breakdown.weighted_subtotal)}</td>
                        </tr>
                        {breakdown.adjustments.map((a, i) => {
                            const neg = a.points < 0;
                            const items = a.detail && a.detail.includes(' | ') ? a.detail.split(' | ') : null;
                            return (
                                <tr key={`${a.code}-${i}`}>
                                    <th scope="row" colSpan={3} className="py-1.5 px-2 text-left font-medium text-slate-700 align-top">
                                        {a.label}
                                        {items ? (
                                            <ul className="mt-1 list-disc list-inside text-xs font-normal text-slate-500 space-y-0.5">
                                                {items.map((it, j) => <li key={j}>{it}</li>)}
                                            </ul>
                                        ) : a.detail ? (
                                            <div className="text-xs font-normal text-slate-500">{a.detail}</div>
                                        ) : null}
                                    </th>
                                    <td className={`py-1.5 px-2 text-right tabular-nums font-bold align-top ${neg ? 'text-red-600' : 'text-emerald-700'}`}>
                                        <span aria-label={neg ? 'penalty' : 'bonus'}>{neg ? '▼ ' : '▲ '}{signed(a.points)}</span>
                                    </td>
                                </tr>
                            );
                        })}
                        {rawOverrides.map((o, i) => (
                            <tr key={`${o.code}-${i}`} className="bg-red-50">
                                <th scope="row" colSpan={3} className="py-1.5 px-2 text-left font-medium text-red-700 align-top">
                                    {o.label}
                                    {o.detail && <div className="text-xs font-normal">{o.detail}</div>}
                                </th>
                                <td className="py-1.5 px-2 text-right tabular-nums font-bold text-red-700 align-top">
                                    {'▼ '}{signed(o.after - o.before)}
                                    <div className="text-[10px] font-normal">{num(o.before)} {'→'} {num(o.after)}</div>
                                </td>
                            </tr>
                        ))}
                        {rawOverrides.length > 0 && (
                            <tr className="text-slate-500">
                                <th scope="row" colSpan={3} className="py-1.5 px-2 text-left font-medium">Running total before final limits</th>
                                <td className="py-1.5 px-2 text-right tabular-nums">{num(breakdown.raw_score)}</td>
                            </tr>
                        )}
                        {finalOverrides.map((o, i) => (
                            <tr key={`${o.code}-${i}`} className="bg-amber-50">
                                <th scope="row" colSpan={3} className="py-1.5 px-2 text-left font-medium text-amber-800">
                                    {o.label}
                                    <div className="text-xs font-normal">{num(o.before)} {'→'} {num(o.after)}</div>
                                </th>
                                <td className="py-1.5 px-2 text-right tabular-nums font-bold text-amber-800">{signed(o.after - o.before)}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr className="bg-indigo-50 font-black text-indigo-700 border-t-2 border-indigo-200">
                            <th scope="row" colSpan={3} className="py-2 px-2 text-left">Final displayed score</th>
                            <td className="py-2 px-2 text-right tabular-nums">{breakdown.overall_score}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
                Domain points are each score multiplied by its weight. Values are shown to one decimal; the engine carries full precision, so displayed lines may differ from the total by a rounding digit.
            </p>
        </section>
    );
};
