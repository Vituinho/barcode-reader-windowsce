/** Same physical label in front of the lens is reported once per window (the scan pipeline also guards). */
export function createCameraDebounce(windowMs = 2500) {
  let last = "";
  let at = 0;
  return (raw: string, now: number) => {
    if (raw === last && now - at < windowMs) return false;
    last = raw;
    at = now;
    return true;
  };
}
