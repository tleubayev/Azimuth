/* eslint-disable @next/next/no-img-element */
/**
 * The azimuth icon mark — a magenta navigation-arrow "A" with a neon-cyan glow.
 * Transparent PNG so it sits cleanly on any dark surface. Same artwork as the
 * app icon / favicon (`/azimuth-icon.png`).
 */
export function AzimuthMark({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/azimuth-icon.png"
      alt="azimuth"
      width={size}
      height={size}
      style={{ width: size, height: size, display: 'block', objectFit: 'contain' }}
      className={className}
    />
  );
}
