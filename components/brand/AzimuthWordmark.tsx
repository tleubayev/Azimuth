/* eslint-disable @next/next/no-img-element */
/**
 * The azimuth wordmark logo (neon-cyan with a magenta navigation-arrow accent).
 * Rendered as a transparent PNG so the baked-in neon glow composites cleanly on
 * the app's dark void background. Source: skill-archive logo #20.
 */
export function AzimuthWordmark({
  height = 40,
  className,
  priority,
}: {
  height?: number;
  className?: string;
  priority?: boolean;
}) {
  // intrinsic aspect ratio of /azimuth-wordmark.png is ~3.36:1
  return (
    <img
      src="/azimuth-wordmark.png"
      alt="azimuth"
      height={height}
      fetchPriority={priority ? 'high' : 'auto'}
      style={{ height, width: 'auto', display: 'block' }}
      className={className}
    />
  );
}
