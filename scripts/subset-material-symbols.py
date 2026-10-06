#!/usr/bin/env python3
"""Build the checked-in finite-name Material Symbols Rounded WOFF2 subset.

Install pinned tooling with:
  python3 -m venv /tmp/rushd-font-subset-venv
  /tmp/rushd-font-subset-venv/bin/python -m pip install -r scripts/font-subset-requirements.txt
  /tmp/rushd-font-subset-venv/bin/python scripts/subset-material-symbols.py
"""

import argparse
import hashlib
from importlib.metadata import PackageNotFoundError, version
import json
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from fontTools.ttLib import TTFont
except ImportError as error:
    raise SystemExit(
        'Font subsetting needs pinned FontTools dependencies. Run '
        '`python3 -m pip install -r scripts/font-subset-requirements.txt`.'
    ) from error


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / 'src/components/material-symbol-icons.json'
SOURCE_PATH = ROOT / 'font-sources/material-symbols-rounded-v370.woff2'
DEFAULT_OUTPUT = ROOT / 'public/fonts/sykg-zNym6YjUruM-QrEh7-nyTnjDwKNJ_190FjzaqkNCeE-subset.woff2'
EXPECTED_SOURCE_SHA256 = '80c1f0011a71e5a2c39bdbb78f63652dd024c6e3635b26bbf3942a991dfa7c5b'
MAX_OUTPUT_BYTES = 150_000
PINNED_TOOL_VERSIONS = {
    'fonttools': '4.61.1',
    'brotli': '1.2.0',
    'zopfli': '0.4.3',
}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_tool_versions():
    mismatches = []
    for package, expected in PINNED_TOOL_VERSIONS.items():
        try:
            actual = version(package)
        except PackageNotFoundError:
            actual = 'missing'
        if actual != expected:
            mismatches.append(f'{package}=={expected} (found {actual})')
    if mismatches:
        raise SystemExit(
            'Font subsetting requires the pinned build-time toolchain: '
            + ', '.join(mismatches)
            + '. Create a venv and install scripts/font-subset-requirements.txt.'
        )


def ligature_mappings(font):
    """Return exact ligature-name to output-glyph mappings from required GSUB."""
    mappings = {}
    table = font['GSUB'].table
    feature_list = getattr(table, 'FeatureList', None)
    lookup_list = getattr(table, 'LookupList', None)
    if feature_list is None or lookup_list is None:
        return mappings

    cmap = font.getBestCmap()
    glyph_to_ascii = {}
    for codepoint in range(32, 127):
        glyph_name = cmap.get(codepoint)
        if glyph_name:
            glyph_to_ascii[glyph_name] = chr(codepoint)

    for feature in feature_list.FeatureRecord:
        if feature.FeatureTag != 'rlig':
            continue
        for lookup_index in feature.Feature.LookupListIndex:
            lookup = lookup_list.Lookup[lookup_index]
            subtables = []
            for subtable in lookup.SubTable:
                if lookup.LookupType == 7:
                    if subtable.ExtensionLookupType == 4:
                        subtables.append(subtable.ExtSubTable)
                elif lookup.LookupType == 4:
                    subtables.append(subtable)
            for subtable in subtables:
                for base_glyph, entries in getattr(subtable, 'ligatures', {}).items():
                    parts = [base_glyph]
                    for entry in entries:
                        sequence = ''.join(glyph_to_ascii.get(glyph, '') for glyph in [*parts, *entry.Component])
                        if sequence:
                            mappings.setdefault(sequence, set()).add(entry.LigGlyph)
                        parts = [base_glyph]
    return mappings


def axis_signature(font):
    axes = font['fvar'].axes
    return [
        (axis.axisTag, axis.minValue, axis.defaultValue, axis.maxValue)
        for axis in axes
    ]


def main():
    verify_tool_versions()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    manifest = json.loads(MANIFEST_PATH.read_text(encoding='utf-8'))
    icons = manifest.get('icons')
    fallback = manifest.get('fallbackIcon')
    if not isinstance(icons, list) or not icons or fallback not in icons:
        raise SystemExit('The icon manifest must include a non-empty icon list and its fallback icon.')
    if len(icons) != len(set(icons)):
        raise SystemExit('The icon manifest contains duplicate names.')

    source_hash = sha256(SOURCE_PATH)
    if source_hash != EXPECTED_SOURCE_SHA256:
        raise SystemExit(f'Unexpected Material Symbols source SHA-256: {source_hash}')

    source = TTFont(SOURCE_PATH)
    glyph_order = set(source.getGlyphOrder())
    cmap = source.getBestCmap()
    source_mappings = ligature_mappings(source)
    selected_glyphs = set()
    expected_icon_outputs = {}

    for icon in icons:
        outputs = source_mappings.get(icon)
        if outputs:
            if len(outputs) != 1:
                raise SystemExit(f'Icon {icon!r} maps to conflicting glyphs: {sorted(outputs)}')
            output_glyph = next(iter(outputs))
        elif icon in glyph_order:
            output_glyph = icon
        else:
            raise SystemExit(f'Icon {icon!r} has no direct glyph or required ligature in the pinned source font.')

        if output_glyph not in glyph_order:
            raise SystemExit(f'Icon {icon!r} maps to absent glyph {output_glyph!r}.')
        expected_icon_outputs[icon] = output_glyph
        selected_glyphs.add(output_glyph)
        for character in icon:
            glyph_name = cmap.get(ord(character))
            if glyph_name is None:
                raise SystemExit(f'Icon {icon!r} needs absent input character {character!r}.')
            selected_glyphs.add(glyph_name)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='rushd-material-symbols-') as temporary_directory:
        glyph_list = Path(temporary_directory) / 'glyphs.txt'
        glyph_list.write_text('\n'.join(sorted(selected_glyphs)) + '\n', encoding='utf-8')
        command = [
            sys.executable,
            '-m',
            'fontTools.subset',
            str(SOURCE_PATH),
            f'--glyphs-file={glyph_list}',
            '--layout-features=rlig',
            '--no-layout-closure',
            '--glyph-names',
            '--flavor=woff2',
            f'--output-file={args.output}',
        ]
        subprocess.run(command, check=True)

    if args.output.stat().st_size > MAX_OUTPUT_BYTES:
        raise SystemExit(
            f'Subset is {args.output.stat().st_size:,} bytes, above the {MAX_OUTPUT_BYTES:,}-byte budget.'
        )

    subset = TTFont(args.output)
    if axis_signature(source) != axis_signature(subset):
        raise SystemExit('Subset changed the Material Symbols variable-font axes.')
    if 'gvar' in source and 'gvar' not in subset:
        raise SystemExit('Subset dropped variable glyph outlines.')
    subset_mappings = ligature_mappings(subset)
    subset_glyphs = set(subset.getGlyphOrder())
    for icon, output_glyph in expected_icon_outputs.items():
        if output_glyph not in subset_glyphs:
            raise SystemExit(f'Subset omitted glyph {output_glyph!r} for icon {icon!r}.')
        if icon in source_mappings and subset_mappings.get(icon) != {output_glyph}:
            raise SystemExit(f'Subset omitted the {icon!r} ligature to glyph {output_glyph!r}.')

    size = args.output.stat().st_size
    reduction = (1 - size / SOURCE_PATH.stat().st_size) * 100
    print(
        f'Material Symbols Rounded v370: {SOURCE_PATH.stat().st_size:,} -> {size:,} bytes '
        f'({reduction:.2f}% smaller); SHA-256 {sha256(args.output)}'
    )


if __name__ == '__main__':
    main()
