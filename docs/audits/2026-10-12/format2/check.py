"""Compare isolated parser output and actual CLI dry-run payload against fixture facts."""
import json
from pathlib import Path

ROOT = Path(__file__).parent


def value_at(row, path):
    """Read a dotted business-field path without filling absent facts."""
    for part in path.split('.'):
        if not isinstance(row, dict):
            return None
        row = row.get(part)
    return row


def differences(case, row):
    """Return factual differences, keeping catalogue gaps separate from assertions."""
    out = []
    for field, expected in case['expected'].items():
        if field in ('catalog_gap', 'catalog_fallback', 'no_duration_inference'):
            continue
        actual = value_at(row, field)
        if field in ('grade_ids', 'subject_ids'):
            actual = actual or []
        if actual != expected:
            out.append({'field': field, 'expected': expected, 'actual': actual})
    if case['expected'].get('no_duration_inference'):
        for field in ('session_duration_minutes_min', 'session_duration_minutes_max'):
            if row.get(field) is not None:
                out.append({'field': field, 'expected': None, 'actual': row[field]})
    if row.get('address_detail') != case['fields']['地址']:
        out.append({'field': 'address_detail', 'expected': case['fields']['地址'], 'actual': row.get('address_detail')})
    return out


def main():
    """Save checked facts without making requests or writing production data."""
    cases = json.loads((ROOT / 'cases.json').read_text())['cases']
    parsed = json.loads((ROOT / 'parser-results.json').read_text())
    preview = json.loads((ROOT / 'import-preview.json').read_text())
    rows = preview.get('data', preview)['request']['body']['confirmed_rows']
    output = []
    assert len(cases) == len(parsed) == len(rows)
    for case, result, row in zip(cases, parsed, rows):
        item = {'id': case['id'], 'provenance': case['provenance']}
        for name in ('raw', 'normalized', 'strict_normalized'):
            assert len(result[name]) == 1, (case['id'], name)
            item[name] = differences(case, result[name][0]['parsed'])
        item['cli_import_preview'] = differences(case, row)
        output.append(item)
    (ROOT / 'checked-results.json').write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    for stage in ('raw', 'normalized', 'strict_normalized', 'cli_import_preview'):
        mismatches = sum(len(item[stage]) for item in output)
        affected = sum(bool(item[stage]) for item in output)
        print(f'{stage}: {affected}/12 cases with mismatches; {mismatches} fields')


if __name__ == '__main__':
    main()
