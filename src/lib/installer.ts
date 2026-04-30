/**
 * Frontend wrapper around the Rust-side install engine.
 *
 * The Rust commands (defined in src-tauri/src/installer.rs) handle the
 * actual download/verify/extract/install work. This module wraps them with
 * typed JS APIs and tracks progress events.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { InstallKind, InstallProgress, InstalledAppRecord } from "./types";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface InstallSignatureArgs {
  method: "cosign-blob";
  public_key_url: string;
  signature_url: string;
}

export interface InstallArgs {
  slug: string;
  repo: string;
  version: string;
  download_url: string;
  kind: InstallKind;
  expected_sha256?: string;
  binary_name?: string;
  signature?: InstallSignatureArgs;
}

export async function installApp(args: InstallArgs): Promise<InstalledAppRecord> {
  if (!IS_TAURI) {
    throw new Error("Installation is only available in the desktop app.");
  }
  return invoke<InstalledAppRecord>("install_app", { args });
}

export async function uninstallApp(slug: string): Promise<void> {
  if (!IS_TAURI) {
    throw new Error("Uninstallation is only available in the desktop app.");
  }
  return invoke<void>("uninstall_app", { slug });
}

export async function listInstalled(): Promise<InstalledAppRecord[]> {
  if (!IS_TAURI) return [];
  return invoke<InstalledAppRecord[]>("list_installed");
}

export async function onInstallProgress(cb: (p: InstallProgress) => void): Promise<UnlistenFn> {
  if (!IS_TAURI) return () => {};
  return listen<InstallProgress>("install-progress", (event) => cb(event.payload));
}

export function isDesktop(): boolean {
  return IS_TAURI;
}
