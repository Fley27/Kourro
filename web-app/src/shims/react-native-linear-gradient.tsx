// react-native-linear-gradient (native-only, Flow source) → CSS gradient.
// Only reached if a chart/dependency imports it; the shared app code does
// not use it directly.
import React from "react";
import { View } from "react-native-web";

export type LinearGradientPoint = { x: number; y: number } | null | undefined;

export type LinearGradientProps = {
  colors: readonly string[];
  locations?: readonly number[] | null;
  start?: LinearGradientPoint;
  end?: LinearGradientPoint;
  style?: unknown;
  children?: React.ReactNode;
};

function angleFromPoints(start: LinearGradientPoint, end: LinearGradientPoint): number {
  const s = start ?? { x: 0.5, y: 0 };
  const e = end ?? { x: 0.5, y: 1 };
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  // CSS 0deg points up; y grows downward in RN coordinates.
  const deg = Math.atan2(dx, -dy) * (180 / Math.PI);
  return (deg + 360) % 360;
}

export function LinearGradient(props: LinearGradientProps): React.ReactElement {
  const { colors, locations, start, end, style, children, ...rest } = props;
  const palette = colors && colors.length > 0 ? colors : ["transparent", "transparent"];
  const stops = palette.map((color, i) => {
    if (locations && locations.length === palette.length) {
      return `${color} ${Math.round(locations[i] * 100)}%`;
    }
    return color;
  });
  const backgroundImage = `linear-gradient(${angleFromPoints(start, end)}deg, ${stops.join(", ")})`;
  return React.createElement(
    View,
    { ...rest, style: [style, { backgroundImage }] },
    children
  );
}

export default LinearGradient;
