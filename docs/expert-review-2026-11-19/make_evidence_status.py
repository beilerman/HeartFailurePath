"""
Builds evidence-status.md: every row of the four evidence tables (outcome, symptom, side effect, dose) with what its figure was checked against, in plain words,
and how many first options it touches. Run influence.ts first (npx tsx docs/expert-review-2026-11-19/influence.ts), then:
    python3 docs/expert-review-2026-11-19/make_evidence_status.py
Sorted so a reviewer sees at once which numbers rest on nothing readable, on a second-hand source, on a computation, on an abstract, or on a full text, label or registry entry.
"""
import json, os, re, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
D = lambda f: json.load(open(f'{ROOT}/data/{f}.json'))
inf = json.load(open(f'{HERE}/influence.json'))
outc, symp, harm, dose = D('outcomeEvidence'), D('symptomEvidence')['rows'], D('harmEvidence'), D('doseEvidence')
RULESET = re.search(r"RULESET_VERSION = '([^']+)'", open(f'{ROOT}/services/rulesetVersion.ts').read()).group(1)
# fingerprint of the data files this document describes; a gate check recomputes it and fails when the document is stale (T15)
DATA_FILES = ['outcomeEvidence', 'symptomEvidence', 'harmEvidence', 'doseEvidence', 'harmDefinitions']
FINGERPRINT = hashlib.sha256(b''.join(open(f'{ROOT}/data/{f}.json', 'rb').read() for f in DATA_FILES)).hexdigest()[:16]
INFERENCE = {'questionnaire': 'converted from another questionnaire', 'outcome_definition': 'converted from a different outcome definition', 'band': 'carried from another EF band', 'population': 'carried from another population',
             'drug_class': 'carried from another drug class', 'arb_to_acei': 'carried from an ARB to ACE inhibitors', 'two_step': 'combined from two comparisons, one against another drug and one against placebo'}
def basis_words(basis, inf=None):  # the words the screen uses (components/expectedEffectModel.ts basisLabel)
    named = [INFERENCE[c] for c in (inf or []) if c in INFERENCE]
    joined = (named[0][0].upper() + named[0][1:] + ''.join((' and ' if i == len(named) - 2 else ', ') + x for i, x in enumerate(named[1:]))) if named else ''
    return {'trial': 'Randomized trial', 'meta_analysis': 'Pooled analysis of trials', 'subgroup': 'Subgroup of a randomized trial', 'indirect_comparison': 'Indirect comparison through enalapril',
            'extrapolated': joined or 'Extrapolated (carried from another population or EF band)', 'conflicting': 'Randomized evidence conflicts; no effect assumed', 'no_outcome_evidence': 'No outcome evidence; no effect assumed',
            'assumed_neutral': 'Assumed no effect (no outcome trial)', 'converted': joined or 'Converted from another questionnaire', 'combined': 'Combined from two steps', 'not_measured': 'Not measured'}.get(basis, basis.replace('_', ' '))
HARM_LEVEL = {'drug': 'Measured for this drug', 'class': 'Measured for the drug class', 'extrapolated': 'Extrapolated (different population, follow-up or control)', 'siblingProxy': 'Borrowed from a sibling class', 'notMeasured': 'Not measured: nothing is charged'}
DOSE_LEVEL = {'drug': 'Measured for this drug', 'class': 'Measured for the drug class', 'siblingProxy': 'Borrowed from a sibling drug', 'not_measured': 'Not measured (a target dose set by this tool is used)'}
EF = {'reduced': 'reduced EF', 'mildly_reduced': 'mildly reduced EF', 'preserved': 'preserved EF'}
OUT = {'all_cause_death': 'death from any cause', 'hf_hospitalization': 'heart-failure hospitalization'}
POP = {'self_identified_black': 'patients who identify as Black', 'atrial_fibrillation': 'atrial fibrillation', 'congested': 'a congested patient', 'other': 'all other patients'}
NO_FIGURE = ('assumed_neutral', 'no_outcome_evidence', 'conflicting', 'not_measured')
WORDS = {  # (rank, plain words); rank 0 = least checked
    'unverified': (0, 'Not verified: no readable source'),
    'secondary_source_quote': (1, 'Quoted second-hand from a review; not read in the primary paper'),
    'conflict_unresolved': (1, 'Sources conflict; not resolved'),
    'not_confirmed_achieved_dose': (0, 'Not verified: the dose achieved was not found'),
    'not_confirmed_mean_target_confirmed': (1, 'The target dose was read; the mean achieved dose was not'),
    'computed_from_secondary_source': (2, 'Computed from figures read in the sources and one quoted second-hand'),
    'computed_from_verified': (3, 'Computed from figures read in the sources'),
    'confirmed_single_secondary_plus_arithmetic': (2, 'Read in one secondary source, with arithmetic'),
    'confirmed_single_secondary': (2, 'Read in one secondary source'),
    'confirmed_secondary_text': (2, 'Read in a secondary source'),
    'confirmed_two_secondary': (2, 'Read in two secondary sources'),
    'verified_fulltext (secondary source)': (2, 'Read in the full text of a secondary source'),
    'abstract_quote': (4, 'Read in the abstract'), 'verified_abstract': (4, 'Read in the abstract'),
    'confirmed_two_sources': (5, 'Read in two sources'), 'confirmed_three_sources': (5, 'Read in three sources'), 'confirmed_with_D5_clamp': (5, 'Read in two sources; highest marketed strength used'),
    'confirmed_label_target_share_only': (4, 'Read in the drug label (share on target only)'),
    'full_text_quote': (5, 'Read in the full text'), 'verified_fulltext': (5, 'Read in the full text'), 'verified_image_table': (5, 'Read from a table in the source'),
    'verified_label': (5, 'Read in the drug label'), 'label_quote': (5, 'Read in the drug label'), 'registry_quote': (5, 'Read in the ClinicalTrials.gov results entry'),
    'n/a': (6, 'No figure to check (an assumption or a not-measured row)'), 'not_applicable': (6, 'No figure to check'),
}
def w(c): return WORDS.get(c, (3, c))
GROUPS = {0: 'Nothing readable (not verified)', 1: 'Second-hand or conflicting sources', 2: 'Computed from a second-hand figure, or read in a secondary source', 3: 'Computed from figures read in the sources', 4: 'Read in an abstract only', 5: 'Read in a full text, label, registry entry or two or more sources', 6: 'No figure to check (assumption, not measured)'}
def fo(kind, id_): return inf.get(kind, {}).get(id_, {}).get('first', 0)
def table(title, rows, cols):
    out = [f'### {title}', '']
    out.append('| ' + ' | '.join(cols) + ' | Checked | First options |'); out.append('|' + '---|' * (len(cols) + 2))
    return out
lines = [f'# Evidence status of every row, rule set {RULESET}', '', f'Rule set: {RULESET}. Data fingerprint: {FINGERPRINT} (the first 16 characters of the SHA-256 of the five evidence data files; a gate check fails when this document no longer matches them).', '',
         'Written for the heart failure experts. For every row of the four evidence tables: what its figure was checked against, in plain words, and how many first options it touches (the 344 reference scenarios across three insurance tiers, 1,032 runs; "first options" counts the runs whose lead option uses the row; a drug already on board counts). '
         'Rows are sorted so that the least-checked, most influential ones come first. "Not verified" means no readable source was found; it is never filled from memory. Generated by `make_evidence_status.py` from `influence.ts` output.', '']
def section(title, items):
    # items: (rank, fo, id, descr, value, basis, status)
    lines.extend([f'## {title}', ''])
    for rank in sorted({i[0] for i in items}):
        sub = sorted([i for i in items if i[0] == rank], key=lambda i: (-i[1], i[2]))
        lines.extend([f'### {GROUPS[rank]} ({len(sub)} rows, {sum(1 for i in sub if i[1] > 0)} touch a first option)', '', '| Row | What | Value | Basis or level | Checked | First options |', '|---|---|---|---|---|---|'])
        for _, f, id_, descr, val, basis, status in sub: lines.append(f'| {id_} | {descr} | {val} | {basis} | {status} | {f} |')
        lines.append('')
items = []
for r in outc:
    rk, st = w(r['verification'])
    if r['basis'] in NO_FIGURE: rk, st = 6, 'No figure to check: an assumption or a row with no measurement'
    # an interval is printed only when it is an interval of the value shown; a no-effect row (conflicting evidence, assumed no effect) has none
    val = f"{r['rr']} ({r['ci_low']} to {r['ci_high']})" if (r['ci_low'] is not None and r['basis'] not in NO_FIGURE) else f"{r['rr']} (no interval)"
    items.append((rk, fo('outcome', r['id']), r['id'], f"{r['drug_class']}, {EF[r['ef_band']]}, {OUT[r['outcome']]}" + (f", {POP.get(r['population_key'], r['population_key'].replace('_', ' '))}" if r.get('population_key') else ''), val, basis_words(r['basis'], r.get('inferences')), st))
section(f'Outcome table ({len(outc)} rows)', items)
items = []
for r in symp:
    rk, st = w(r['verification'])
    if r['basis'] == 'not_measured': rk, st = 6, 'No figure to check: not measured'
    val = 'not measured' if r['basis'] == 'not_measured' else (f"{r['kccq_points']} ({r['ci_low']} to {r['ci_high']})" if r['ci_low'] is not None else f"{r['kccq_points']} (no interval)")
    items.append((rk, fo('symptom', r['id']), r['id'], f"{r['drug_class']}, {EF[r['ef_band']]}", val, basis_words(r['basis'], r.get('inferences')), st))
section(f'Health status table, KCCQ-equivalent points ({len(symp)} rows)', items)
items = []
for r in harm['rows']:
    rk, st = w(r['verification']); n = fo('harm', r['id'])
    if r['level'] == 'notMeasured': rk, st = 6, 'No figure to check: not measured'
    win = r.get('excess_window')
    items.append((rk, n, r['id'], f"{r['drug_class']}, {r['effect']}", 'not measured' if r['level'] == 'notMeasured' else (f"{r['one_year_excess_pct']}% over {win}" if win else f"{r['one_year_excess_pct']}% a year"), HARM_LEVEL.get(r['level'], r['level']), st))
for m in harm['multipliers']:
    items.append((3 if m['level'] != 'drug' else 4, fo('mult', m['id']), m['id'], f"multiplier, {m['effect']}", f"x{m['ratio']}", HARM_LEVEL.get(m['level'], m['level']), 'Computed from counts in the source table'))
section(f'Side-effect table ({len(harm["rows"])} rows and {len(harm["multipliers"])} multipliers)', items)
items = []
for a in dose['anchors']:
    rk, st = w(a['verification']); items.append((rk, fo('dose', a['id']), a['id'], f"{a['drug']} ({a['drug_class']})", 'no anchor' if a['full_credit_daily_mg'] is None else f"{a['full_credit_daily_mg']} {a.get('unit', 'mg')}", DOSE_LEVEL.get(a['level'], a['level']), st))
section(f'Dose table ({len(dose["anchors"])} anchors)', items)
pri = inf['priors']
lines.extend(['## The three priors and the rows that rest mostly on a prior', '',
    'Every measured figure is weighted against a prior of no effect before it is used for ranking: a precisely measured row barely moves, an imprecise one is pulled toward no effect. There are three priors, one per kind of figure, each computed from the tables (never typed):', '',
    f"- Death from any cause: prior variance {pri['death']:.3f} on the log relative-risk scale.",
    f"- Heart-failure hospitalization: prior variance {pri['hospitalization']:.3f} on the log relative-risk scale.",
    f"- Health status (KCCQ-equivalent points): prior variance {pri['symptoms']:.3f} points squared.", '',
    f"A row whose weight on its own trial figure is below {pri['mostlyPriorBelow']:.1f} is marked \"mostly prior\": the value used rests mostly on the assumption of no effect, not on the trial figure. Rows with no estimate (no interval beside no effect, assumed no effect, conflicting evidence, not measured) are not weighted at all.", '',
    '| Row | Table | Weight on the trial figure |', '|---|---|---|'])
for m in sorted(inf['mostlyPrior'], key=lambda m: m['B']): lines.append(f"| {m['id']} | {m['kind']} | {m['B']:.2f} |")
lines.append('')
open(f'{HERE}/evidence-status.md', 'w').write('\n'.join(lines) + '\n')
tot = {k: len(v) for k, v in {'outcome': outc, 'symptom': symp, 'harm': harm['rows'], 'dose': dose['anchors']}.items()}
print(tot)
