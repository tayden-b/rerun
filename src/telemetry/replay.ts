// Dependency-free so client components can import it.

/** Suffix on demo replays of a configured model; recorded token counts are estimated at that model's price. */
export const REPLAY_MARKER = ' · replay';

export const isReplay = (model: string) => model.endsWith(REPLAY_MARKER);

export const baseModel = (model: string) => (isReplay(model) ? model.slice(0, -REPLAY_MARKER.length) : model);
