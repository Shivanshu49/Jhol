"use client";

import { MotionConfig } from "framer-motion";

/** Disables transform/layout animation for visitors who ask for reduced motion. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
