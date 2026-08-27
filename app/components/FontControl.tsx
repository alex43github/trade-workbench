"use client";

import { useState } from "react";
import { useFontScale } from "../uiPreferences";
import styles from "./FontControl.module.css";

export default function FontControl({ className = "" }: { className?: string }) {
  const { fontScale, setFontScale } = useFontScale();
  const [open, setOpen] = useState(false);
  const percentage = Math.round(fontScale * 100);

  return (
    <div className={`${styles.control} ${className}`.trim()}>
      <button type="button" aria-label="字号设置" className={styles.button} onClick={() => setOpen((current) => !current)}>
        字号 {percentage}%
      </button>
      {open ? (
        <div className={styles.popover} role="dialog" aria-label="页面字号设置">
          <strong>页面字号</strong>
          <output>{percentage}%</output>
          <input aria-label="页面字号" type="range" min="1" max="1.5" step="0.05" value={fontScale} onChange={(event) => setFontScale(Number(event.target.value))} />
          <div className={styles.presets}>
            <button type="button" onClick={() => setFontScale(1.2)}>默认大</button>
            <button type="button" onClick={() => setFontScale(1.35)}>更大</button>
            <button type="button" onClick={() => setFontScale(1.5)}>特大</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
