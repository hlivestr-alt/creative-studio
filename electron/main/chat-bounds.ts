export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowContentSize {
  width: number;
  height: number;
}

export const hiddenChatViewBounds = (): LayoutRect => ({ x: 0, y: 0, width: 0, height: 0 });

/**
 * Convert the renderer's ChatGPT host rectangle into safe child-view bounds.
 *
 * The renderer rectangle is relative to the BrowserWindow content viewport, and
 * Electron View bounds are relative to the same content view in logical/DIP
 * coordinates. We therefore intentionally do not multiply by
 * window.devicePixelRatio; DPI is already represented by the logical viewport.
 * Flooring the start and ceiling the end preserves the whole visible host while
 * the final clamp guarantees that the native view cannot extend past the window.
 */
export function calculateChatViewBounds(containerRect: LayoutRect, windowContentSize: WindowContentSize): LayoutRect {
  const contentWidth = Math.max(0, Math.floor(finiteOrZero(windowContentSize.width)));
  const contentHeight = Math.max(0, Math.floor(finiteOrZero(windowContentSize.height)));
  const left = finiteOrZero(containerRect.x);
  const top = finiteOrZero(containerRect.y);
  const width = Math.max(0, finiteOrZero(containerRect.width));
  const height = Math.max(0, finiteOrZero(containerRect.height));
  const startX = clamp(Math.floor(left), 0, contentWidth);
  const startY = clamp(Math.floor(top), 0, contentHeight);
  const endX = clamp(Math.ceil(left + width), startX, contentWidth);
  const endY = clamp(Math.ceil(top + height), startY, contentHeight);

  return { x: startX, y: startY, width: endX - startX, height: endY - startY };
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
