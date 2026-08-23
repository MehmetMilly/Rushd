#!/bin/sh
set -eu

if [ "${RUSHD_BASELINE_WRITE:-}" != "1" ]; then
  echo "Refusing to normalize immutable P00 images without RUSHD_BASELINE_WRITE=1." >&2
  exit 2
fi
if [ "${RUSHD_BASELINE_REPLACE:-}" != "1" ]; then
  echo "Refusing to normalize existing P00 images without RUSHD_BASELINE_REPLACE=1." >&2
  exit 3
fi

normalize_tree() {
  directory="$1"
  width="$2"
  height="$3"
  find "$directory" -type f -name '*.png' -print0 | while IFS= read -r -d '' image; do
    temporary="${image}.normalized.png"
    sips --setProperty format png --resampleHeightWidth "$height" "$width" "$image" --out "$temporary" >/dev/null
    mv "$temporary" "$image"
  done
}

for language in ar en; do
  for theme in dark light; do
    normalize_tree "docs/baseline/current/${language}/${theme}/390x844" 390 844
    normalize_tree "docs/baseline/current/${language}/${theme}/1024x1366" 1024 1366
    normalize_tree "docs/baseline/current/${language}/${theme}/1440x900" 1440 900
    normalize_tree "test-results/p00-motion-frames/${language}__${theme}__390x844" 390 844
    normalize_tree "test-results/p00-motion-frames/${language}__${theme}__1024x1366" 1024 1366
    normalize_tree "test-results/p00-motion-frames/${language}__${theme}__1440x900" 1440 900
  done
done

for profile in auto full balanced lite; do
  normalize_tree "test-results/p00-motion-frames/motion-profiles__${profile}" 390 844
done

echo "Normalized P00 screenshots to true PNG at their locked viewport dimensions."
