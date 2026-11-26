"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    __POS_UNSAVED_WORK__?: boolean;
    __POS_ALLOW_UNLOAD__?: boolean;
  }
}

export function setPosUnsavedWork(dirty: boolean): void {
  if (typeof window !== "undefined") {
    window.__POS_UNSAVED_WORK__ = dirty;
  }
}

export function hasPosUnsavedWork(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.__POS_UNSAVED_WORK__);
}

export function allowNextUnload(): void {
  if (typeof window !== "undefined") {
    window.__POS_ALLOW_UNLOAD__ = true;
    setTimeout(() => {
      window.__POS_ALLOW_UNLOAD__ = false;
    }, 1500);
  }
}

export function WindowCloseGuard() {
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (window.__POS_ALLOW_UNLOAD__) return;
      e.preventDefault();
      e.returnValue = "確定離開？進行中未儲存的單據將會消失。";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return null;
}
