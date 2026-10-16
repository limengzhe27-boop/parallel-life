/** Coordinates are layout-viewport pixels, including browser keyboard panning. */
export function viewportGeometry(input: {
  height: number;
  offsetTop: number;
  scale: number;
  fallbackHeight: number;
}) {
  const height =
    Number.isFinite(input.height) && input.height > 0 ? input.height : input.fallbackHeight;
  return {
    height,
    top: Number.isFinite(input.offsetTop) ? Math.max(0, input.offsetTop) : 0,
    // Do not compensate pinch zoom: users must retain normal magnification/panning.
    track: Math.abs(input.scale - 1) < 0.01,
  };
}
