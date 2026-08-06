// Sizes are stored internally in centimetres; the UI shows/edits inches.
export const cmToIn = (cm: number) => Math.round(cm / 2.54);
export const inToCm = (inch: number) => Math.round(inch * 2.54);

/** Custom size label in inches (e.g. "48×36 in"), or null if not set. */
export const customSizeLabel = (w?: number | null, h?: number | null) =>
  w && h ? `${cmToIn(w)}×${cmToIn(h)} in` : null;
