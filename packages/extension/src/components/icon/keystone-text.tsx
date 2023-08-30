import React, { FunctionComponent } from "react";
import { IconProps } from "./types";

export const KeystoneTextIcon: FunctionComponent<IconProps> = ({
  width = "auto",
  height = "1.5rem",
  color,
}) => {
  const colors: { [key: string]: { color1: string; color2: string } } = {
    dark: {
      color1: "#f5f8ff",
      color2: "#3d71ff",
    },
    light: {
      color1: "#000",
      color2: "#1f5aff",
    },
  };
  const color1 = color && color in colors ? colors[color].color1 : color;
  const color2 = color && color in colors ? colors[color].color2 : color;
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 1136 256"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="m48 40h96l-64 136h-48z" fill={color1 || "currentColor"} />
      <path d="m208 216h-96l64-136h48z" fill={color2 || "currentColor"} />
      <g fill={color1 || "currentColor"}>
        <path d="m916 80h34.323l29.677 59.863v-59.863h20v96h-20v-20h-14.323l-29.677-59.8624v79.8624h-20z" />
        <path d="m784 80h-80v16h30v80h20v-80h30z" />
        <path d="m1096 80h-52v16h-20v80h72v-16h-52v-24h44v-16h-44v-24h52z" />
        <path d="m496 80h-52v16h-20v80h72v-16h-52v-24h44v-16h-44v-24h52z" />
        <path d="m340 124.001 37.674-44.001h26.329l-40.786 47.636 44.785 48.364h-27.258l-40.744-44v44h-20v-96h20z" />
        <path d="m511.995 80 34.005 53.999v42.001h20v-42l34.005-54h-23.635l-20.37 32.347-20.37-32.347z" />
        <path
          d="m686 83s-14-5-34-5c-28 0-38 11-38 28 0 15 8 25 30 30 18 4.091 24 5 24 13s-7 10-20 10c-15 0-34-8-34-8v20c5.667 2.333 20 7 38 7 21 0 38-6 38-28 0-21-12.068-26.682-36-32-18-4-20-9-20-12 0-6.8373 5-11 18-11 8 0 19.372 2.4419 34 6z"
          opacity=".9"
        />
        <path
          clipRule="evenodd"
          d="m846 178c30.72 0 48-22 48-50s-17.28-50-48-50-48 22-48 50 17.28 50 48 50zm0-18c17.92 0 28-14.08 28-32s-10.08-32-28-32-28 14.08-28 32 10.08 32 28 32z"
          fillRule="evenodd"
        />
      </g>
    </svg>
  );
};
