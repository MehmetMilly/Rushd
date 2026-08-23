#!/bin/sh
set -eu

if [ "${RUSHD_BASELINE_WRITE:-}" != "1" ]; then
  echo "Refusing to write immutable P00 motion evidence without RUSHD_BASELINE_WRITE=1." >&2
  exit 2
fi

frame_root="test-results/p00-motion-frames"
baseline_root="docs/baseline/current"

encode_pair() {
  source_dir="$1"
  output_stem="$2"
  mkdir -p "$(dirname "$output_stem")"
  if [ -e "${output_stem}.webm" ] || [ -e "${output_stem}.mp4" ]; then
    if [ "${RUSHD_BASELINE_REPLACE:-}" != "1" ]; then
      echo "Refusing to overwrite existing motion evidence: ${output_stem}.{webm,mp4}" >&2
      exit 3
    fi
    overwrite_flag="-y"
  else
    overwrite_flag="-n"
  fi

  ffmpeg "$overwrite_flag" -loglevel error -framerate 12 -i "${source_dir}/frame-%03d.png" \
    -c:v libvpx-vp9 -pix_fmt yuv420p -an "${output_stem}.webm"
  ffmpeg "$overwrite_flag" -loglevel error -framerate 12 -i "${source_dir}/frame-%03d.png" \
    -c:v libx264 -pix_fmt yuv420p -movflags +faststart -an "${output_stem}.mp4"
}

for language in ar en; do
  for theme in dark light; do
    for viewport in 390x844 1024x1366 1440x900; do
      key="${language}__${theme}__${viewport}"
      encode_pair "${frame_root}/${key}" "${baseline_root}/${language}/${theme}/${viewport}/motion-add-full"
    done
  done
done

for profile in auto full balanced lite; do
  encode_pair "${frame_root}/motion-profiles__${profile}" "${baseline_root}/motion-profiles/${profile}/motion-add-${profile}"
done

echo "Encoded immutable P00 WebM/MP4 motion evidence."
