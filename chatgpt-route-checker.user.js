// ==UserScript==
// @name         ChatGPT Route Checker
// @namespace    chatgpt-route-checker
// @version      6.0.5
// @description  每輪自動比對 ChatGPT 請求模型與服務端路由標注，提供可收合、可拖曳的狀態面板
// @author       Yat-mo
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @sandbox      raw
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const VERSION = "6.0.5";
  const INSTANCE_KEY = "__CHATGPT_ROUTE_CHECKER_V6__";
  const HOST_ID = "__chatgpt_route_checker_v6_host__";

  if (window[INSTANCE_KEY]) {
    console.info(`[Route Checker] v${VERSION} 已在執行`);
    return;
  }

  window[INSTANCE_KEY] = true;

  const nativeFetch =
    typeof window.fetch === "function"
      ? window.fetch.bind(window)
      : null;

  const NativeXHR = window.XMLHttpRequest;
  const nativeXHROpen = NativeXHR?.prototype?.open;
  const nativeXHRSend = NativeXHR?.prototype?.send;

  const nativeBeacon =
    typeof navigator.sendBeacon === "function"
      ? navigator.sendBeacon.bind(navigator)
      : null;

  const STORAGE = Object.freeze({
    minimized: "__route_checker_v6_minimized__",
    strict: "__route_checker_v6_strict__",
    anchor: "__route_checker_v6_anchor__"
  });

  function readBoolean(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value === "1";
    } catch {
      return fallback;
    }
  }

  function writeBoolean(key, value) {
    try {
      localStorage.setItem(key, value ? "1" : "0");
    } catch {}
  }

  function readJSON(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  function validAnchor(value) {
    if (!value || typeof value !== "object") return null;

    const horizontal =
      value.horizontal === "left" || value.horizontal === "right"
        ? value.horizontal
        : null;

    const vertical =
      value.vertical === "top" || value.vertical === "bottom"
        ? value.vertical
        : null;

    const x = Number(value.x);
    const y = Number(value.y);

    if (!horizontal || !vertical || !Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }

    return {
      horizontal,
      vertical,
      x: Math.max(8, x),
      y: Math.max(8, y)
    };
  }

  const defaultAnchor = Object.freeze({
    horizontal: "right",
    vertical: "bottom",
    x: 18,
    y: 18
  });

  const state = {
    active: false,
    generationId: 0,
    turnKey: null,
    conversationId: null,
    lastRequestAt: 0,

    requestModel: null,
    thinkingEffort: null,
    requestError: null,

    serverModel: null,
    serverSource: null,
    assistantModel: null,
    resolvedModel: null,
    requestedExperience: null,
    responseThinkingEffort: null,
    domModel: null,

    startedAt: null,
    updatedAt: null,
    firstEvidenceAt: null,
    responseComplete: false,
    domBaselineNode: null,
    telemetrySeen: 0,
    telemetryScanned: 0,

    uiMinimized: readBoolean(STORAGE.minimized, true),
    strictMode: readBoolean(STORAGE.strict, false),
    detailsOpen: false,
    toastMessage: null,
    anchor:
      validAnchor(readJSON(STORAGE.anchor, null)) ||
      { ...defaultAnchor }
  };

  const oldHost = document.getElementById(HOST_ID);
  oldHost?.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = [
    "position:fixed",
    "z-index:2147483647",
    "display:block",
    "width:max-content",
    "height:max-content",
    "max-width:calc(100vw - 16px)",
    "max-height:calc(100vh - 16px)",
    "isolation:isolate",
    "contain:layout style",
    "pointer-events:auto"
  ].join(";");

  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      :host {
        --rc-font: ui-sans-serif, -apple-system, BlinkMacSystemFont,
          "SF Pro Text", "Segoe UI", "PingFang TC", "Noto Sans TC",
          "Microsoft JhengHei", sans-serif;
        --rc-mono: "SFMono-Regular", "Cascadia Code", "Roboto Mono",
          Consolas, monospace;

        --rc-bg: rgba(252, 252, 253, 0.82);
        --rc-bg-solid: #fcfcfd;
        --rc-surface: rgba(255, 255, 255, 0.68);
        --rc-surface-strong: rgba(255, 255, 255, 0.9);
        --rc-hover: rgba(20, 20, 24, 0.06);
        --rc-pressed: rgba(20, 20, 24, 0.1);
        --rc-border: rgba(20, 20, 28, 0.12);
        --rc-border-soft: rgba(20, 20, 28, 0.075);
        --rc-text: #17171b;
        --rc-text-secondary: #5f6069;
        --rc-text-tertiary: #85868f;
        --rc-shadow: 0 22px 60px rgba(21, 24, 31, 0.18),
          0 5px 16px rgba(21, 24, 31, 0.08);
        --rc-pill-shadow: 0 10px 32px rgba(21, 24, 31, 0.16),
          0 2px 8px rgba(21, 24, 31, 0.08);

        --rc-idle: #737783;
        --rc-idle-soft: rgba(115, 119, 131, 0.1);
        --rc-info: #4966db;
        --rc-info-soft: rgba(73, 102, 219, 0.11);
        --rc-ok: #14804f;
        --rc-ok-soft: rgba(20, 128, 79, 0.11);
        --rc-warn: #a86505;
        --rc-warn-soft: rgba(190, 118, 11, 0.12);
        --rc-danger: #c73547;
        --rc-danger-soft: rgba(199, 53, 71, 0.11);

        color: var(--rc-text);
        color-scheme: light;
        font-family: var(--rc-font);
        font-size: 14px;
        line-height: 1.45;
        text-rendering: optimizeLegibility;
        -webkit-font-smoothing: antialiased;
      }

      :host([data-theme="dark"]) {
        --rc-bg: rgba(27, 28, 32, 0.82);
        --rc-bg-solid: #1c1d21;
        --rc-surface: rgba(255, 255, 255, 0.055);
        --rc-surface-strong: rgba(255, 255, 255, 0.085);
        --rc-hover: rgba(255, 255, 255, 0.075);
        --rc-pressed: rgba(255, 255, 255, 0.12);
        --rc-border: rgba(255, 255, 255, 0.14);
        --rc-border-soft: rgba(255, 255, 255, 0.085);
        --rc-text: #f4f4f5;
        --rc-text-secondary: #b3b4bb;
        --rc-text-tertiary: #85868f;
        --rc-shadow: 0 24px 70px rgba(0, 0, 0, 0.42),
          0 5px 18px rgba(0, 0, 0, 0.3);
        --rc-pill-shadow: 0 12px 38px rgba(0, 0, 0, 0.36),
          0 2px 10px rgba(0, 0, 0, 0.22);

        --rc-idle: #a1a5af;
        --rc-idle-soft: rgba(161, 165, 175, 0.12);
        --rc-info: #8ba3ff;
        --rc-info-soft: rgba(108, 134, 236, 0.15);
        --rc-ok: #55c991;
        --rc-ok-soft: rgba(54, 181, 119, 0.14);
        --rc-warn: #efb454;
        --rc-warn-soft: rgba(223, 150, 37, 0.15);
        --rc-danger: #ff7888;
        --rc-danger-soft: rgba(232, 75, 94, 0.15);

        color-scheme: dark;
      }

      *, *::before, *::after {
        box-sizing: border-box;
      }

      button {
        color: inherit;
        font: inherit;
      }

      button:focus-visible {
        outline: 2px solid var(--rc-info);
        outline-offset: 2px;
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      .tone-idle {
        --tone: var(--rc-idle);
        --tone-soft: var(--rc-idle-soft);
      }

      .tone-info {
        --tone: var(--rc-info);
        --tone-soft: var(--rc-info-soft);
      }

      .tone-ok {
        --tone: var(--rc-ok);
        --tone-soft: var(--rc-ok-soft);
      }

      .tone-warn {
        --tone: var(--rc-warn);
        --tone-soft: var(--rc-warn-soft);
      }

      .tone-danger {
        --tone: var(--rc-danger);
        --tone-soft: var(--rc-danger-soft);
      }

      .pill,
      .card {
        border: 1px solid var(--rc-border);
        background: var(--rc-bg);
        -webkit-backdrop-filter: blur(24px) saturate(165%);
        backdrop-filter: blur(24px) saturate(165%);
      }

      .pill {
        position: relative;
        display: flex;
        align-items: center;
        min-width: 116px;
        max-width: min(284px, calc(100vw - 16px));
        min-height: 42px;
        margin: 0;
        padding: 5px 8px 5px 6px;
        border-radius: 999px;
        box-shadow: var(--rc-pill-shadow);
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
        transition: background-color 140ms ease, border-color 140ms ease,
          box-shadow 180ms ease, transform 120ms ease;
      }

      .pill:hover {
        border-color: color-mix(in srgb, var(--tone) 32%, var(--rc-border));
        background: color-mix(in srgb, var(--rc-bg-solid) 88%, var(--tone) 12%);
      }

      .pill:active {
        transform: scale(0.975);
      }

      :host([data-dragging="true"]) .pill,
      :host([data-dragging="true"]) .drag-region {
        cursor: grabbing;
      }

      .pill-mark {
        position: relative;
        display: grid;
        place-items: center;
        width: 31px;
        height: 31px;
        flex: 0 0 31px;
        border-radius: 999px;
        color: var(--tone);
        background: var(--tone-soft);
      }

      .pill-mark svg {
        width: 16px;
        height: 16px;
      }

      .pill-copy {
        min-width: 0;
        margin: 0 8px 0 7px;
        text-align: left;
      }

      .pill-label {
        display: block;
        overflow: hidden;
        color: var(--rc-text);
        font-size: 12px;
        font-weight: 680;
        line-height: 1.2;
        letter-spacing: 0.012em;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .pill-model {
        display: block;
        max-width: 188px;
        margin-top: 2px;
        overflow: hidden;
        color: var(--rc-text-tertiary);
        font-family: var(--rc-mono);
        font-size: 9.5px;
        line-height: 1.1;
        letter-spacing: 0.015em;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .pill-chevron {
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        flex: 0 0 20px;
        border-radius: 999px;
        color: var(--rc-text-tertiary);
        background: var(--rc-hover);
      }

      .pill-chevron svg {
        width: 12px;
        height: 12px;
      }

      .card {
        width: min(392px, calc(100vw - 16px));
        max-height: calc(100vh - 16px);
        overflow: hidden;
        border-radius: 22px;
        box-shadow: var(--rc-shadow);
        transform-origin: bottom right;
      }

      .materialize {
        animation: materialize 210ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
      }

      @keyframes materialize {
        from {
          opacity: 0;
          transform: scale(0.965) translateY(5px);
          filter: blur(3px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
          filter: blur(0);
        }
      }

      .card-header {
        position: relative;
        display: flex;
        align-items: center;
        min-height: 58px;
        padding: 10px 11px 10px 15px;
        border-bottom: 1px solid var(--rc-border-soft);
      }

      .drag-region {
        display: flex;
        align-items: center;
        min-width: 0;
        flex: 1;
        cursor: grab;
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
      }

      .brand-icon {
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        flex: 0 0 34px;
        border: 1px solid var(--rc-border-soft);
        border-radius: 11px;
        color: var(--rc-text-secondary);
        background: var(--rc-surface-strong);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
      }

      .brand-icon svg {
        width: 19px;
        height: 19px;
      }

      .brand-copy {
        min-width: 0;
        margin-left: 10px;
      }

      .brand-title {
        overflow: hidden;
        color: var(--rc-text);
        font-size: 13px;
        font-weight: 720;
        line-height: 1.15;
        letter-spacing: -0.008em;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .brand-subtitle {
        margin-top: 3px;
        color: var(--rc-text-tertiary);
        font-size: 10px;
        font-weight: 520;
        line-height: 1.1;
        letter-spacing: 0.015em;
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: 3px;
        margin-left: 8px;
      }

      .icon-button {
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        padding: 0;
        border: 0;
        border-radius: 10px;
        color: var(--rc-text-secondary);
        background: transparent;
        cursor: pointer;
        transition: color 120ms ease, background-color 120ms ease,
          transform 100ms ease;
      }

      .icon-button:hover {
        color: var(--rc-text);
        background: var(--rc-hover);
      }

      .icon-button:active {
        transform: scale(0.93);
        background: var(--rc-pressed);
      }

      .icon-button svg {
        width: 17px;
        height: 17px;
      }

      .card-scroll {
        max-height: calc(100vh - 75px);
        overflow: auto;
        overscroll-behavior: contain;
        scrollbar-width: thin;
        scrollbar-color: var(--rc-border) transparent;
      }

      .card-scroll::-webkit-scrollbar {
        width: 8px;
      }

      .card-scroll::-webkit-scrollbar-thumb {
        border: 2px solid transparent;
        border-radius: 999px;
        background: var(--rc-border);
        background-clip: padding-box;
      }

      .content {
        padding: 14px;
      }

      .status-card {
        display: grid;
        grid-template-columns: 42px minmax(0, 1fr);
        gap: 11px;
        align-items: center;
        min-height: 72px;
        padding: 12px;
        border: 1px solid color-mix(in srgb, var(--tone) 18%, transparent);
        border-radius: 16px;
        background: var(--tone-soft);
      }

      .status-icon {
        display: grid;
        place-items: center;
        width: 42px;
        height: 42px;
        border-radius: 14px;
        color: var(--tone);
        background: color-mix(in srgb, var(--tone) 11%, var(--rc-surface-strong));
        box-shadow: inset 0 0 0 1px
          color-mix(in srgb, var(--tone) 12%, transparent);
      }

      .status-icon svg {
        width: 22px;
        height: 22px;
      }

      .status-title {
        color: var(--rc-text);
        font-size: 15px;
        font-weight: 730;
        line-height: 1.22;
        letter-spacing: -0.012em;
      }

      .status-description {
        margin-top: 4px;
        color: var(--rc-text-secondary);
        font-size: 11.5px;
        line-height: 1.42;
      }

      .checking-ring {
        width: 20px;
        height: 20px;
        border: 2px solid color-mix(in srgb, var(--tone) 22%, transparent);
        border-top-color: var(--tone);
        border-radius: 999px;
        animation: spin 0.85s linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .comparison {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 30px minmax(0, 1fr);
        align-items: stretch;
        margin-top: 12px;
      }

      .model-card {
        min-width: 0;
        padding: 11px;
        border: 1px solid var(--rc-border-soft);
        border-radius: 14px;
        background: var(--rc-surface);
      }

      .model-label {
        display: flex;
        align-items: center;
        gap: 5px;
        color: var(--rc-text-tertiary);
        font-size: 9.5px;
        font-weight: 650;
        line-height: 1.2;
        letter-spacing: 0.055em;
        text-transform: uppercase;
      }

      .model-value {
        margin-top: 7px;
        overflow: hidden;
        color: var(--rc-text);
        font-family: var(--rc-mono);
        font-size: 11.5px;
        font-weight: 650;
        line-height: 1.35;
        letter-spacing: -0.01em;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .model-value.pending {
        color: var(--rc-text-tertiary);
        font-family: var(--rc-font);
        font-weight: 540;
      }

      .model-note {
        margin-top: 5px;
        overflow: hidden;
        color: var(--rc-text-tertiary);
        font-size: 9.5px;
        line-height: 1.25;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .compare-bridge {
        position: relative;
        display: grid;
        place-items: center;
        color: var(--tone);
      }

      .compare-bridge::before {
        position: absolute;
        left: 4px;
        right: 4px;
        top: 50%;
        height: 1px;
        content: "";
        background: color-mix(in srgb, var(--tone) 28%, transparent);
      }

      .compare-bridge span {
        position: relative;
        z-index: 1;
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        border: 1px solid color-mix(in srgb, var(--tone) 22%, var(--rc-border));
        border-radius: 999px;
        background: var(--rc-bg-solid);
      }

      .compare-bridge svg {
        width: 12px;
        height: 12px;
      }

      .settings-row {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 54px;
        margin-top: 12px;
        padding: 8px 10px 8px 12px;
        border: 1px solid var(--rc-border-soft);
        border-radius: 14px;
        background: var(--rc-surface);
      }

      .settings-copy {
        min-width: 0;
        flex: 1;
      }

      .settings-title {
        color: var(--rc-text);
        font-size: 11.5px;
        font-weight: 660;
        line-height: 1.2;
      }

      .settings-description {
        margin-top: 4px;
        color: var(--rc-text-tertiary);
        font-size: 9.5px;
        line-height: 1.35;
      }

      .switch {
        position: relative;
        width: 39px;
        height: 24px;
        flex: 0 0 39px;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: var(--rc-border);
        cursor: pointer;
        transition: background-color 160ms ease;
      }

      .switch::after {
        position: absolute;
        top: 3px;
        left: 3px;
        width: 18px;
        height: 18px;
        border-radius: 999px;
        content: "";
        background: #fff;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
        transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
      }

      .switch[aria-checked="true"] {
        background: var(--rc-info);
      }

      .switch[aria-checked="true"]::after {
        transform: translateX(15px);
      }

      .details {
        margin-top: 10px;
        overflow: hidden;
        border: 1px solid var(--rc-border-soft);
        border-radius: 14px;
        background: var(--rc-surface);
      }

      .details-toggle {
        display: flex;
        align-items: center;
        width: 100%;
        min-height: 44px;
        padding: 0 11px;
        border: 0;
        color: var(--rc-text-secondary);
        background: transparent;
        cursor: pointer;
        text-align: left;
      }

      .details-toggle:hover {
        background: var(--rc-hover);
      }

      .details-toggle-label {
        flex: 1;
        font-size: 11px;
        font-weight: 640;
      }

      .details-toggle-note {
        margin-right: 8px;
        color: var(--rc-text-tertiary);
        font-size: 9.5px;
      }

      .details-chevron {
        width: 14px;
        height: 14px;
        transition: transform 160ms ease;
      }

      .details-toggle[aria-expanded="true"] .details-chevron {
        transform: rotate(180deg);
      }

      .details-content {
        padding: 0 11px 9px;
        border-top: 1px solid var(--rc-border-soft);
      }

      .data-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(110px, 1.15fr);
        gap: 12px;
        align-items: start;
        padding: 8px 1px;
        border-bottom: 1px solid var(--rc-border-soft);
      }

      .data-row:last-child {
        border-bottom: 0;
      }

      .data-key {
        min-width: 0;
        color: var(--rc-text-tertiary);
        font-family: var(--rc-mono);
        font-size: 9.5px;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }

      .data-value {
        min-width: 0;
        color: var(--rc-text-secondary);
        font-family: var(--rc-mono);
        font-size: 9.5px;
        font-weight: 620;
        line-height: 1.35;
        overflow-wrap: anywhere;
        text-align: right;
      }

      .data-value.empty {
        color: var(--rc-text-tertiary);
        font-family: var(--rc-font);
        font-weight: 500;
      }

      .footnote {
        display: flex;
        align-items: flex-start;
        gap: 7px;
        margin: 11px 2px 1px;
        color: var(--rc-text-tertiary);
        font-size: 9.5px;
        line-height: 1.45;
      }

      .footnote svg {
        width: 13px;
        height: 13px;
        flex: 0 0 13px;
        margin-top: 1px;
      }

      .toast {
        position: absolute;
        top: 48px;
        right: 12px;
        z-index: 3;
        padding: 6px 9px;
        border: 1px solid var(--rc-border);
        border-radius: 9px;
        color: var(--rc-text);
        background: var(--rc-bg-solid);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
        font-size: 10px;
        font-weight: 650;
        animation: toast-in 150ms ease both;
      }

      @keyframes toast-in {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @media (max-width: 480px) {
        .card {
          width: min(372px, calc(100vw - 12px));
          max-height: calc(100vh - 12px);
          border-radius: 19px;
        }

        .content {
          padding: 12px;
        }

        .card-scroll {
          max-height: calc(100vh - 70px);
        }

        .comparison {
          grid-template-columns: minmax(0, 1fr) 26px minmax(0, 1fr);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          scroll-behavior: auto !important;
          animation-duration: 0.001ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.001ms !important;
        }
      }

      @media (prefers-reduced-transparency: reduce) {
        .pill,
        .card {
          background: var(--rc-bg-solid);
          -webkit-backdrop-filter: none;
          backdrop-filter: none;
        }
      }

      @media (prefers-contrast: more) {
        :host {
          --rc-bg: var(--rc-bg-solid);
          --rc-border: currentColor;
        }

        .pill,
        .card,
        .status-card,
        .model-card,
        .settings-row,
        .details {
          border-width: 2px;
        }
      }

      @media (forced-colors: active) {
        .pill,
        .card,
        .status-card,
        .model-card,
        .settings-row,
        .details,
        .switch {
          border: 1px solid CanvasText;
          background: Canvas;
          color: CanvasText;
          forced-color-adjust: auto;
        }
      }
    </style>
    <div id="app"></div>
  `;

  const app = shadow.getElementById("app");

  function esc(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function normalizeModel(value) {
    return String(value || "").trim().toLowerCase();
  }

  function parseModelFamily(value) {
    const slug = normalizeModel(value);
    if (!slug) return null;

    const gpt = slug.match(/(?:^|-)gpt-(\d+)(o)?(?:[-.](\d+))?/i);

    if (gpt) {
      return {
        kind: "gpt",
        major: gpt[1],
        variant: gpt[2] ? "o" : (gpt[3] || null),
        key: `gpt-${gpt[1]}${gpt[2] ? "o" : gpt[3] ? `-${gpt[3]}` : ""}`
      };
    }

    const oSeries = slug.match(/(?:^|-)o(\d+)(?:[-.](\d+))?/i);

    if (oSeries) {
      return {
        kind: "o",
        major: oSeries[1],
        variant: oSeries[2] || null,
        key: `o${oSeries[1]}${oSeries[2] ? `-${oSeries[2]}` : ""}`
      };
    }

    return {
      kind: "other",
      major: slug,
      variant: null,
      key: slug
    };
  }

  function sameModelFamily(left, right) {
    const a = parseModelFamily(left);
    const b = parseModelFamily(right);

    if (!a || !b || a.kind !== b.kind || a.major !== b.major) {
      return false;
    }

    if (a.key === b.key) return true;

    if (a.kind === "gpt" && (!a.variant || !b.variant)) {
      return true;
    }

    return false;
  }

  function routeTier(value) {
    const slug = normalizeModel(value);
    if (!slug) return null;

    if (/(?:^|[-_])(nano)(?:$|[-_])/.test(slug)) return 0;
    if (/(?:^|[-_])(mini|lite)(?:$|[-_])/.test(slug)) return 1;
    if (/(?:^|[-_])(instant|fast)(?:$|[-_])/.test(slug)) return 2;
    if (/(?:^|[-_])(thinking|reasoning)(?:$|[-_])/.test(slug)) return 4;
    if (/(?:^|[-_])(pro|max)(?:$|[-_])/.test(slug)) return 5;

    return null;
  }

  function effortTier(value) {
    const effort = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");

    return ({
      none: 0,
      disabled: 0,
      minimal: 1,
      low: 2,
      medium: 3,
      high: 4,
      xhigh: 5,
      extrahigh: 5,
      max: 6,
      maximum: 6
    })[effort] ?? null;
  }

  function isAutoModel(value) {
    const slug = normalizeModel(value);
    return (
      slug === "auto" ||
      /(?:^|[-_])(auto|automatic)(?:$|[-_])/.test(slug)
    );
  }

  function observedModel() {
    if (state.serverModel) {
      return {
        model: state.serverModel,
        source: state.serverSource || "server",
        primary: true
      };
    }

    if (state.assistantModel) {
      return {
        model: state.assistantModel,
        source: "assistant",
        primary: false
      };
    }

    if (state.resolvedModel) {
      return {
        model: state.resolvedModel,
        source: "resolved",
        primary: false
      };
    }

    if (state.domModel) {
      return {
        model: state.domModel,
        source: "dom",
        primary: false
      };
    }

    return null;
  }

  function modelEvidence() {
    const evidence = [];

    function add(field, model, source, primary = false) {
      if (typeof model !== "string" || !model.trim()) return;

      evidence.push({
        field,
        model,
        source,
        primary
      });
    }

    add(
      "server_ste_metadata.model_slug",
      state.serverModel,
      state.serverSource || "server",
      true
    );

    add(
      "assistant.metadata.model_slug",
      state.assistantModel,
      "assistant"
    );

    add(
      "resolved_model_slug",
      state.resolvedModel,
      "resolved"
    );

    add(
      "DOM data-message-model-slug",
      state.domModel,
      "dom"
    );

    return evidence;
  }

  function conflictingEvidence(requestedModel = state.requestModel) {
    const requested = normalizeModel(requestedModel);
    if (!requested) return [];

    return modelEvidence().filter(
      item => normalizeModel(item.model) !== requested
    );
  }

  function evidenceSummary(items) {
    return items
      .map(item => `${sourceLabel(item.source)}: ${item.model}`)
      .join("；");
  }

  function sourceLabel(source) {
    return ({
      stream: "服務端串流標注",
      telemetry: "遙測標注",
      server: "服務端標注",
      assistant: "助理訊息 metadata",
      resolved: "resolved model",
      dom: "頁面 DOM"
    })[source] || "未知來源";
  }

  function routeStatus() {
    if (!state.active) {
      return {
        key: "idle",
        tone: "idle",
        icon: "idle",
        mini: "等待檢測",
        title: "等待下一輪",
        description: "發送訊息後，這裡會自動比對本輪模型路由。",
        resolved: false
      };
    }

    if (state.requestError) {
      return {
        key: "request-error",
        tone: "danger",
        icon: "danger",
        mini: "請求失敗",
        title: "這輪請求未完成",
        description: "網路請求失敗，因此無法完成路由比對。",
        resolved: true
      };
    }

    if (!state.requestModel) {
      return {
        key: "reading-request",
        tone: "info",
        icon: "checking",
        mini: "檢測中",
        title: "正在讀取請求",
        description: "已偵測到新一輪訊息，正在解析請求模型。",
        resolved: false
      };
    }

    const observed = observedModel();

    if (!observed) {
      return {
        key: "waiting-server",
        tone: "info",
        icon: "checking",
        mini: "檢測中",
        title: "正在等待路由標注",
        description: "請求模型已取得，等待服務端回傳本輪模型資料。",
        resolved: false
      };
    }

    const requested = normalizeModel(state.requestModel);
    const routed = normalizeModel(observed.model);

    const requestedEffortTier = effortTier(state.thinkingEffort);
    const responseEffortTier = effortTier(state.responseThinkingEffort);
    const conflicts = conflictingEvidence(state.requestModel);
    const secondaryConflicts = conflicts.filter(item => !item.primary);

    if (!observed.primary) {
      if (state.responseComplete) {
        return {
          key: "primary-unavailable",
          tone: "warn",
          icon: "warn",
          mini: "無法確認",
          title: "缺少主要服務端標注",
          description: `本輪只取得${sourceLabel(observed.source)}，無法確認請求模型與服務端路由是否一致。`,
          resolved: true
        };
      }

      return {
        key: "waiting-primary",
        tone: "info",
        icon: "checking",
        mini: "檢測中",
        title: "正在等待主要服務端標注",
        description: `已取得${sourceLabel(observed.source)}，收到 server_ste_metadata.model_slug 後才會給出判定。`,
        resolved: false
      };
    }

    if (
      requestedEffortTier !== null &&
      responseEffortTier !== null &&
      responseEffortTier < requestedEffortTier
    ) {
      return {
        key: "effort-downgrade",
        tone: "danger",
        icon: "danger",
        mini: "疑似降智",
        title: "思考強度低於請求",
        description: `請求為 ${state.thinkingEffort}，回傳標注為 ${state.responseThinkingEffort}。`,
        resolved: true
      };
    }

    if (isAutoModel(requested) && observed.primary) {
      return {
        key: "automatic",
        tone: "info",
        icon: "route",
        mini: "自動路由",
        title: "本輪使用自動路由",
        description: `系統選擇了 ${observed.model}，自動模式沒有固定模型可供精確比對。`,
        resolved: true
      };
    }

    if (state.strictMode && conflicts.length) {
      return {
        key: "strict-evidence-conflict",
        tone: "danger",
        icon: "danger",
        mini: "標注衝突",
        title: "嚴格比對未通過",
        description: `${evidenceSummary(conflicts)}，與請求模型 ${state.requestModel} 不同。`,
        resolved: true
      };
    }

    if (
      observed.primary &&
      requested === routed &&
      secondaryConflicts.length
    ) {
      return {
        key: "secondary-evidence-conflict",
        tone: "warn",
        icon: "warn",
        mini: "標注有差異",
        title: "交叉驗證發現不同標注",
        description: `主要服務端標注與請求相同，但${evidenceSummary(secondaryConflicts)}。`,
        resolved: true
      };
    }

    if (requested === routed) {
      return {
        key: "exact-match",
        tone: "ok",
        icon: "ok",
        mini: "路由正常",
        title: "路由完全一致",
        description: `請求模型與${sourceLabel(observed.source)}完全相同。`,
        resolved: true
      };
    }

    const sameFamily = sameModelFamily(requested, routed);
    const requestedTier =
      routeTier(requested) ??
      (requestedEffortTier !== null && requestedEffortTier >= 2 ? 4 : null);
    const routedTier = routeTier(routed);
    const explicitLowerTier =
      sameFamily &&
      requestedTier !== null &&
      routedTier !== null &&
      routedTier < requestedTier;

    if (state.strictMode) {
      return {
        key: "strict-difference",
        tone: "danger",
        icon: "danger",
        mini: "疑似降智",
        title: "嚴格比對未通過",
        description: "請求模型與服務端 model slug 並非逐字一致。",
        resolved: true
      };
    }

    if (explicitLowerTier) {
      return {
        key: "explicit-downgrade",
        tone: "danger",
        icon: "danger",
        mini: "疑似降智",
        title: "偵測到較低路由層級",
        description: "請求與回覆屬於同系列，但服務端標注含有較低層級的路由詞。",
        resolved: true
      };
    }

    if (sameFamily) {
      return {
        key: "family-variant",
        tone: "warn",
        icon: "warn",
        mini: "同系列變體",
        title: "同系列，內部路由不同",
        description: "模型系列一致，但內部 slug 不同。這值得留意，尚不能單憑此項判定降智。",
        resolved: true
      };
    }

    return {
      key: "model-mismatch",
      tone: "danger",
      icon: "danger",
      mini: "疑似降智",
      title: "模型路由不一致",
      description: "請求模型與服務端標注屬於不同模型系列。",
      resolved: true
    };
  }

  function icon(name) {
    const common = `viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true"`;

    const icons = {
      brand: `<svg ${common}>
        <circle cx="5" cy="6" r="2.1"></circle>
        <circle cx="19" cy="6" r="2.1"></circle>
        <circle cx="12" cy="18" r="2.1"></circle>
        <path d="M7.1 6h9.8M6.7 7.7l4.1 8.5M17.3 7.7l-4.1 8.5"></path>
      </svg>`,
      idle: `<svg ${common}>
        <circle cx="12" cy="12" r="8"></circle>
        <path d="M12 8v4l2.7 1.7"></path>
      </svg>`,
      ok: `<svg ${common}>
        <circle cx="12" cy="12" r="8.5"></circle>
        <path d="m8.3 12.1 2.4 2.4 5.1-5.2"></path>
      </svg>`,
      warn: `<svg ${common}>
        <path d="M10.3 4.2 3.1 17a2 2 0 0 0 1.8 3h14.2a2 2 0 0 0 1.8-3L13.7 4.2a2 2 0 0 0-3.4 0Z"></path>
        <path d="M12 9v4M12 16.5h.01"></path>
      </svg>`,
      danger: `<svg ${common}>
        <circle cx="12" cy="12" r="8.5"></circle>
        <path d="M12 7.8v5.1M12 16.3h.01"></path>
      </svg>`,
      route: `<svg ${common}>
        <path d="M5 5v4a3 3 0 0 0 3 3h8"></path>
        <path d="m13 9 3 3-3 3"></path>
        <path d="M5 19v-3a4 4 0 0 1 4-4"></path>
      </svg>`,
      chevronUp: `<svg ${common}><path d="m8 14 4-4 4 4"></path></svg>`,
      chevronDown: `<svg ${common}><path d="m8 10 4 4 4-4"></path></svg>`,
      collapse: `<svg ${common}>
        <path d="M6 9h5V4M18 15h-5v5M11 9 5 3M13 15l6 6"></path>
      </svg>`,
      copy: `<svg ${common}>
        <rect x="8" y="8" width="11" height="11" rx="2"></rect>
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>
      </svg>`,
      refresh: `<svg ${common}>
        <path d="M4 7v5h5"></path>
        <path d="M5.7 16.5A8 8 0 1 0 4.2 9"></path>
      </svg>`,
      swap: `<svg ${common}>
        <path d="M7 8h10M14 5l3 3-3 3M17 16H7M10 13l-3 3 3 3"></path>
      </svg>`,
      info: `<svg ${common}>
        <circle cx="12" cy="12" r="8.5"></circle>
        <path d="M12 11v5M12 7.8h.01"></path>
      </svg>`
    };

    return icons[name] || icons.info;
  }

  function statusIcon(status) {
    if (status.icon === "checking") {
      return '<span class="checking-ring" aria-hidden="true"></span>';
    }

    return icon(status.icon);
  }

  function modelDisplay(value) {
    return value
      ? `<div class="model-value" title="${esc(value)}">${esc(value)}</div>`
      : '<div class="model-value pending">讀取中</div>';
  }

  function fieldRow(key, value) {
    const hasValue = value !== null && value !== undefined && value !== "";
    const missingLabel = state.responseComplete
      ? "本輪未提供"
      : "等待回傳";

    return `
      <div class="data-row">
        <div class="data-key">${esc(key)}</div>
        <div class="data-value${hasValue ? "" : " empty"}">
          ${hasValue ? esc(value) : missingLabel}
        </div>
      </div>
    `;
  }

  function crossCheckLabel() {
    const evidence = modelEvidence();
    const conflicts = conflictingEvidence();
    const hasPrimaryEvidence = evidence.some(item => item.primary);

    if (!state.requestModel || !evidence.length) {
      return null;
    }

    if (!hasPrimaryEvidence) {
      return state.responseComplete
        ? "缺少主要服務端標注，無法確認"
        : "等待主要服務端標注";
    }

    if (conflicts.length) {
      return `衝突：${evidenceSummary(conflicts)}`;
    }

    return "目前所有標注一致";
  }

  function detectionLatency() {
    if (!state.startedAt || !state.firstEvidenceAt) return null;

    const milliseconds = Math.max(0, state.firstEvidenceAt - state.startedAt);
    return milliseconds < 1000
      ? `${milliseconds} ms`
      : `${(milliseconds / 1000).toFixed(2)} s`;
  }

  function formatTime(timestamp) {
    if (!timestamp) return null;

    try {
      return new Date(timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    } catch {
      return null;
    }
  }

  function miniModel(status) {
    const observed = observedModel();

    if (status.key === "idle") return `Route Checker v${VERSION}`;
    if (!status.resolved) return state.requestModel || "正在取得模型資料";

    return observed?.model || state.requestModel || `Route Checker v${VERSION}`;
  }

  let renderQueued = false;
  let lastRenderedMode = null;

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;

    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function render() {
    if (drag?.moved) {
      renderAfterDrag = true;
      return;
    }

    mountHost();
    syncTheme();

    const status = routeStatus();
    const observed = observedModel();
    const mode = state.uiMinimized ? "pill" : "card";
    const animateClass = lastRenderedMode && lastRenderedMode !== mode
      ? " materialize"
      : "";

    lastRenderedMode = mode;

    if (state.uiMinimized) {
      app.innerHTML = `
        <button
          type="button"
          class="pill tone-${status.tone}${animateClass}"
          data-action="toggle-panel"
          data-drag-handle
          aria-expanded="false"
          aria-controls="route-checker-card"
          aria-label="${esc(status.mini)}，展開 Route Checker"
          title="拖曳可移動，點一下展開"
        >
          <span class="pill-mark">${statusIcon(status)}</span>
          <span class="pill-copy">
            <span class="pill-label">${esc(status.mini)}</span>
            <span class="pill-model">${esc(miniModel(status))}</span>
          </span>
          <span class="pill-chevron">${icon("chevronUp")}</span>
        </button>
      `;
    } else {
      const observedSource = observed
        ? sourceLabel(observed.source)
        : "等待服務端資料";

      const time = formatTime(state.updatedAt || state.startedAt);

      app.innerHTML = `
        <section
          id="route-checker-card"
          class="card tone-${status.tone}${animateClass}"
          aria-label="ChatGPT Route Checker"
        >
          <header class="card-header">
            <div class="drag-region" data-drag-handle title="拖曳可移動面板">
              <span class="brand-icon">${icon("brand")}</span>
              <span class="brand-copy">
                <span class="brand-title">Route Checker</span>
                <span class="brand-subtitle">CHATGPT · V${VERSION}</span>
              </span>
            </div>

            <div class="header-actions">
              <button
                type="button"
                class="icon-button"
                data-action="copy"
                aria-label="複製本輪路由資料"
                title="複製本輪資料"
              >${icon("copy")}</button>

              <button
                type="button"
                class="icon-button"
                data-action="refresh-data"
                aria-label="重新掃描頁面模型資料"
                title="重新掃描"
              >${icon("refresh")}</button>

              <button
                type="button"
                class="icon-button"
                data-action="toggle-panel"
                aria-expanded="true"
                aria-controls="route-checker-card"
                aria-label="收起 Route Checker"
                title="收起"
              >${icon("collapse")}</button>
            </div>

            ${state.toastMessage ? `<div class="toast" role="status">${esc(state.toastMessage)}</div>` : ""}
          </header>

          <div class="card-scroll">
            <div class="content">
              <section
                class="status-card tone-${status.tone}"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                <span class="status-icon">${statusIcon(status)}</span>
                <span>
                  <span class="status-title">${esc(status.title)}</span>
                  <span class="status-description">${esc(status.description)}</span>
                </span>
              </section>

              <section class="comparison" aria-label="模型路由對照">
                <div class="model-card">
                  <div class="model-label">請求模型</div>
                  ${modelDisplay(state.requestModel)}
                  <div class="model-note">
                    ${esc(state.thinkingEffort ? `effort: ${state.thinkingEffort}` : "request.model")}
                  </div>
                </div>

                <div class="compare-bridge" aria-hidden="true">
                  <span>${icon("swap")}</span>
                </div>

                <div class="model-card">
                  <div class="model-label">觀察到的模型</div>
                  ${modelDisplay(observed?.model)}
                  <div class="model-note" title="${esc(observedSource)}">
                    ${esc(observedSource)}
                  </div>
                </div>
              </section>

              <section class="settings-row" aria-label="判定設定">
                <div class="settings-copy">
                  <div class="settings-title">嚴格比對</div>
                  <div class="settings-description">
                    開啟後，只要 model slug 不完全一致就會標紅。
                  </div>
                </div>
                <button
                  type="button"
                  class="switch"
                  role="switch"
                  aria-checked="${state.strictMode ? "true" : "false"}"
                  aria-label="嚴格比對"
                  data-action="toggle-strict"
                  title="${state.strictMode ? "關閉嚴格比對" : "開啟嚴格比對"}"
                ><span class="sr-only">嚴格比對</span></button>
              </section>

              <section class="details">
                <button
                  type="button"
                  class="details-toggle"
                  data-action="toggle-details"
                  aria-expanded="${state.detailsOpen ? "true" : "false"}"
                  aria-controls="route-checker-details"
                >
                  <span class="details-toggle-label">技術資料</span>
                  <span class="details-toggle-note">${esc(time ? `更新 ${time}` : "等待資料")}</span>
                  <span class="details-chevron">${icon("chevronDown")}</span>
                </button>

                ${state.detailsOpen ? `
                  <div id="route-checker-details" class="details-content">
                    ${fieldRow("request.model", state.requestModel)}
                    ${fieldRow("request.thinking_effort", state.thinkingEffort)}
                    ${fieldRow("server_ste_metadata.model_slug", state.serverModel)}
                    ${fieldRow("assistant.metadata.model_slug", state.assistantModel)}
                    ${fieldRow("resolved_model_slug", state.resolvedModel)}
                    ${fieldRow("requested_model_experience", state.requestedExperience)}
                    ${fieldRow("response.thinking_effort", state.responseThinkingEffort)}
                    ${fieldRow("DOM data-message-model-slug", state.domModel)}
                    ${fieldRow("判定來源", observedSource)}
                    ${fieldRow("首個路由資料耗時", detectionLatency())}
                    ${fieldRow("回覆擷取狀態", state.responseComplete ? "已結束" : "接收中")}
                    ${fieldRow("遙測封包", `${state.telemetryScanned}/${state.telemetrySeen}`)}
                    ${fieldRow("交叉驗證", crossCheckLabel())}
                  </div>
                ` : ""}
              </section>

              <p class="footnote">
                ${icon("info")}
                <span>
                  判定依據是前端可見的路由 metadata。紅色表示標注不一致，不能單獨證明實際推理品質下降。
                </span>
              </p>
            </div>
          </div>
        </section>
      `;
    }

    requestAnimationFrame(() => {
      applyAnchor();
      clampHost();
    });
  }

  function mountHost() {
    const root = document.documentElement || document.body;

    if (root && !host.isConnected) {
      root.appendChild(host);
      applyAnchor();
      syncTheme();
    }
  }

  function syncTheme() {
    const root = document.documentElement;
    const explicit = String(
      root?.getAttribute("data-theme") ||
      root?.getAttribute("data-color-scheme") ||
      ""
    ).toLowerCase();

    const classDark = root?.classList?.contains("dark");
    const explicitDark = explicit.includes("dark");
    const explicitLight = explicit.includes("light");
    const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;

    host.dataset.theme =
      classDark || explicitDark || (!explicitLight && systemDark)
        ? "dark"
        : "light";
  }

  function applyAnchor() {
    const anchor = validAnchor(state.anchor) || { ...defaultAnchor };
    const margin = 8;

    host.style.left = "auto";
    host.style.right = "auto";
    host.style.top = "auto";
    host.style.bottom = "auto";

    if (anchor.horizontal === "left") {
      host.style.left = `${Math.max(margin, anchor.x)}px`;
    } else {
      host.style.right = `${Math.max(margin, anchor.x)}px`;
    }

    if (anchor.vertical === "top") {
      host.style.top = `${Math.max(margin, anchor.y)}px`;
    } else {
      host.style.bottom = `${Math.max(margin, anchor.y)}px`;
    }
  }

  function clampHost() {
    if (!host.isConnected) return;

    const margin = 8;
    const rect = host.getBoundingClientRect();

    let left = rect.left;
    let top = rect.top;

    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);

    left = Math.min(maxLeft, Math.max(margin, left));
    top = Math.min(maxTop, Math.max(margin, top));

    if (
      Math.abs(left - rect.left) > 0.5 ||
      Math.abs(top - rect.top) > 0.5
    ) {
      host.style.left = `${left}px`;
      host.style.top = `${top}px`;
      host.style.right = "auto";
      host.style.bottom = "auto";
      captureAnchor();
    }
  }

  function captureAnchor() {
    const rect = host.getBoundingClientRect();
    const horizontal =
      rect.left + rect.width / 2 < window.innerWidth / 2
        ? "left"
        : "right";

    const vertical =
      rect.top + rect.height / 2 < window.innerHeight / 2
        ? "top"
        : "bottom";

    state.anchor = {
      horizontal,
      vertical,
      x: Math.max(8, horizontal === "left" ? rect.left : window.innerWidth - rect.right),
      y: Math.max(8, vertical === "top" ? rect.top : window.innerHeight - rect.bottom)
    };

    writeJSON(STORAGE.anchor, state.anchor);
    applyAnchor();
  }

  function resetPosition() {
    state.anchor = { ...defaultAnchor };
    writeJSON(STORAGE.anchor, state.anchor);
    applyAnchor();
    requestAnimationFrame(clampHost);
  }

  let drag = null;
  let toastTimer = null;
  let suppressNextClick = false;
  let renderAfterDrag = false;

  shadow.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;

    const handle = event.target.closest("[data-drag-handle]");
    if (!handle) return;

    const isPill = handle.classList.contains("pill");

    if (!isPill && event.target.closest("button")) {
      return;
    }

    const rect = host.getBoundingClientRect();

    drag = {
      pointerId: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      width: rect.width,
      height: rect.height,
      moved: false
    };

    handle.setPointerCapture?.(event.pointerId);
  });

  shadow.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (!drag.moved && Math.hypot(dx, dy) < 5) return;

    drag.moved = true;
    suppressNextClick = true;
    host.dataset.dragging = "true";

    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - drag.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - drag.height - margin);

    const left = Math.min(maxLeft, Math.max(margin, drag.startLeft + dx));
    const top = Math.min(maxTop, Math.max(margin, drag.startTop + dy));

    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";

    event.preventDefault();
  });

  function finishDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;

    try {
      drag.handle.releasePointerCapture?.(event.pointerId);
    } catch {}

    const moved = drag.moved;

    if (moved) captureAnchor();

    delete host.dataset.dragging;
    drag = null;

    if (moved) {
      window.setTimeout(() => {
        suppressNextClick = false;
      }, 0);
    }

    if (renderAfterDrag) {
      renderAfterDrag = false;
      scheduleRender();
    }
  }

  shadow.addEventListener("pointerup", finishDrag);
  shadow.addEventListener("pointercancel", finishDrag);

  shadow.addEventListener("click", async event => {
    const action = event.target
      .closest("[data-action]")
      ?.dataset?.action?.trim();
    if (!action) return;

    if (suppressNextClick) {
      suppressNextClick = false;
      event.preventDefault();
      return;
    }

    if (action === "toggle-panel") {
      state.uiMinimized = !state.uiMinimized;
      writeBoolean(STORAGE.minimized, state.uiMinimized);
      scheduleRender();
      return;
    }

    if (action === "toggle-strict") {
      state.strictMode = !state.strictMode;
      writeBoolean(STORAGE.strict, state.strictMode);
      scheduleRender();
      return;
    }

    if (action === "toggle-details") {
      state.detailsOpen = !state.detailsOpen;
      scheduleRender();
      return;
    }

    if (action === "refresh-data") {
      refreshVisibleData();
      return;
    }

    if (action === "copy") {
      await copySnapshot();
    }
  });

  function snapshot() {
    const status = routeStatus();
    const observed = observedModel();
    const evidence = modelEvidence();
    const conflicts = conflictingEvidence();
    const confirmed = evidence.some(item => item.primary);

    return {
      checkerVersion: VERSION,
      checkedAt: new Date(state.updatedAt || Date.now()).toISOString(),
      verdict: status.title,
      strictMode: state.strictMode,
      request: {
        model: state.requestModel,
        thinkingEffort: state.thinkingEffort
      },
      observed: observed
        ? {
            model: observed.model,
            source: sourceLabel(observed.source),
            primary: observed.primary
          }
        : null,
      metadata: {
        serverModel: state.serverModel,
        assistantModel: state.assistantModel,
        resolvedModel: state.resolvedModel,
        requestedExperience: state.requestedExperience,
        responseThinkingEffort: state.responseThinkingEffort,
        domModel: state.domModel
      },
      crossCheck: {
        confirmed,
        passed: confirmed ? conflicts.length === 0 : null,
        evidence: evidence.map(item => ({
          field: item.field,
          model: item.model,
          source: sourceLabel(item.source),
          primary: item.primary,
          matchesRequest:
            normalizeModel(item.model) === normalizeModel(state.requestModel)
        })),
        conflicts: conflicts.map(item => ({
          field: item.field,
          model: item.model,
          source: sourceLabel(item.source)
        }))
      },
      capture: {
        responseComplete: state.responseComplete,
        telemetrySeen: state.telemetrySeen,
        telemetryScanned: state.telemetryScanned,
        firstEvidenceAfterMs:
          state.startedAt && state.firstEvidenceAt
            ? Math.max(0, state.firstEvidenceAt - state.startedAt)
            : null,
        unavailableFields: state.responseComplete
          ? [
              ["serverModel", state.serverModel],
              ["assistantModel", state.assistantModel],
              ["resolvedModel", state.resolvedModel],
              ["requestedExperience", state.requestedExperience],
              ["responseThinkingEffort", state.responseThinkingEffort],
              ["domModel", state.domModel]
            ]
              .filter(([, value]) => value === null || value === undefined)
              .map(([key]) => key)
          : []
      }
    };
  }

  async function writeClipboard(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {}
    }

    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.cssText = "position:fixed;left:-9999px;top:0";
      document.documentElement.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      return copied;
    } catch {
      return false;
    }
  }

  async function copySnapshot() {
    const copied = await writeClipboard(JSON.stringify(snapshot(), null, 2));
    if (!copied) return;

    showToast("已複製");
  }

  function showToast(message) {
    state.toastMessage = message;
    scheduleRender();

    if (toastTimer) {
      window.clearTimeout(toastTimer);
    }

    toastTimer = window.setTimeout(() => {
      state.toastMessage = null;
      toastTimer = null;
      scheduleRender();
    }, 1200);
  }

  function markEvidence() {
    const now = Date.now();

    if (!state.firstEvidenceAt) {
      state.firstEvidenceAt = now;
    }

    state.updatedAt = now;
  }

  function markResponseComplete(context = {}) {
    if (!contextIsCurrent(context) || state.responseComplete) return;

    state.responseComplete = true;
    state.updatedAt = Date.now();
    scheduleRender();
  }

  function latestAssistantCandidate() {
    const nodes = document.querySelectorAll(
      '[data-message-author-role="assistant"]'
    );

    if (!nodes.length) return null;

    const root = nodes[nodes.length - 1];
    const modelNode = root.hasAttribute("data-message-model-slug")
      ? root
      : root.querySelector("[data-message-model-slug]");

    return {
      node: root,
      slug: modelNode?.getAttribute("data-message-model-slug") || null
    };
  }

  function applyDomCandidate(candidate, force = false) {
    if (!state.active) return false;

    if (
      !candidate ||
      !candidate.slug ||
      (!force && candidate.node === state.domBaselineNode)
    ) {
      return false;
    }

    if (!force && state.domModel === candidate.slug) return false;

    state.domModel = candidate.slug;
    markEvidence();
    return true;
  }

  function refreshDomModel(force = false) {
    return applyDomCandidate(latestAssistantCandidate(), force);
  }

  function assistantCandidateFromElement(element) {
    if (!element || element.nodeType !== 1) return null;

    let assistant = element.matches?.('[data-message-author-role="assistant"]')
      ? element
      : element.closest?.('[data-message-author-role="assistant"]');

    if (!assistant) {
      const descendants = element.querySelectorAll?.(
        '[data-message-author-role="assistant"]'
      );

      if (descendants?.length) {
        assistant = descendants[descendants.length - 1];
      }
    }

    if (!assistant) return null;

    const modelNode = assistant.hasAttribute("data-message-model-slug")
      ? assistant
      : assistant.querySelector("[data-message-model-slug]");

    return {
      node: assistant,
      slug: modelNode?.getAttribute("data-message-model-slug") || null
    };
  }

  function refreshVisibleData() {
    const refreshed = refreshDomModel(true);
    state.updatedAt = Date.now();
    showToast(refreshed ? "已重新掃描" : "頁面沒有可讀資料");
  }

  function extractTurnKey(request) {
    try {
      const messages = Array.isArray(request?.messages)
        ? request.messages
        : [];

      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];

        if (message?.author?.role === "user" && message?.id) {
          return message.id;
        }
      }

      if (request?.message?.author?.role === "user") {
        return request.message.id || null;
      }

      return request?.parent_message_id || null;
    } catch {
      return null;
    }
  }

  function resetTurn(request, turnKey) {
    const baseline = latestAssistantCandidate();

    state.active = true;
    state.generationId += 1;
    state.turnKey = turnKey || `turn-${Date.now()}`;
    state.conversationId = request?.conversation_id || state.conversationId || null;

    state.requestModel = null;
    state.thinkingEffort = null;
    state.requestError = null;

    state.serverModel = null;
    state.serverSource = null;
    state.assistantModel = null;
    state.resolvedModel = null;
    state.requestedExperience = null;
    state.responseThinkingEffort = null;
    state.domModel = null;

    state.startedAt = Date.now();
    state.updatedAt = null;
    state.firstEvidenceAt = null;
    state.responseComplete = false;
    state.telemetrySeen = 0;
    state.telemetryScanned = 0;
    state.domBaselineNode = baseline?.node || null;
  }

  function beginOrUpdateTurn(request) {
    const now = Date.now();
    const newTurnKey = extractTurnKey(request);
    const isDefinitelyNewTurn =
      Boolean(newTurnKey) &&
      newTurnKey !== state.turnKey;

    if (!state.active || isDefinitelyNewTurn) {
      resetTurn(request, newTurnKey);
    } else if (!state.turnKey && newTurnKey) {
      state.turnKey = newTurnKey;
    }

    state.lastRequestAt = now;

    if (typeof request?.model === "string") {
      state.requestModel = request.model;
    }

    const thinkingEffort =
      request?.thinking_effort ??
      request?.reasoning_effort ??
      request?.model_configuration?.thinking_effort;

    if (thinkingEffort !== null && thinkingEffort !== undefined) {
      state.thinkingEffort = String(thinkingEffort);
    }

    const requestedExperience =
      request?.requested_model_experience ??
      request?.model_configuration?.requested_model_experience;

    if (requestedExperience !== null && requestedExperience !== undefined) {
      state.requestedExperience = String(requestedExperience);
    }

    scheduleRender();
    return state.generationId;
  }

  function contextIsCurrent(context) {
    return (
      !context?.generationId ||
      context.generationId === state.generationId
    );
  }

  function applyServerMetadata(metadata, context = {}) {
    if (
      !metadata ||
      typeof metadata !== "object" ||
      !contextIsCurrent(context)
    ) {
      return;
    }

    let changed = false;
    let modelCaptured = false;

    if (typeof metadata.model_slug === "string") {
      const canApply =
        context.source !== "telemetry" ||
        !state.serverModel ||
        state.serverSource === "telemetry";

      if (canApply && state.serverModel !== metadata.model_slug) {
        state.serverModel = metadata.model_slug;
        state.serverSource = context.source || "server";
        changed = true;
        modelCaptured = true;
      }
    }

    if (typeof metadata.requested_model_experience === "string") {
      if (state.requestedExperience !== metadata.requested_model_experience) {
        state.requestedExperience = metadata.requested_model_experience;
        changed = true;
      }
    }

    const responseEffort =
      metadata.thinking_effort ??
      metadata.reasoning_effort;

    if (responseEffort !== null && responseEffort !== undefined) {
      const value = String(responseEffort);

      if (state.responseThinkingEffort !== value) {
        state.responseThinkingEffort = value;
        changed = true;
      }
    }

    if (changed) {
      if (modelCaptured) {
        markEvidence();
      } else {
        state.updatedAt = Date.now();
      }

      if (context.source === "telemetry") {
        state.responseComplete = true;
      }

      scheduleRender();
    }
  }

  function scanObject(object, context = {}, depth = 0, seen = new WeakSet()) {
    if (
      object === null ||
      object === undefined ||
      depth > 16 ||
      !contextIsCurrent(context)
    ) {
      return;
    }

    if (typeof object === "string") {
      const text = object.trim();

      if (
        (text.startsWith("{") || text.startsWith("[")) &&
        /model_slug|server_ste_metadata|resolved_model|requested_model_experience|thinking_effort|reasoning_effort/.test(text)
      ) {
        try {
          scanObject(JSON.parse(text), context, depth + 1, seen);
        } catch {}
      }

      return;
    }

    if (typeof object !== "object" || seen.has(object)) return;
    seen.add(object);

    if (object.type === "server_ste_metadata" && object.metadata) {
      applyServerMetadata(object.metadata, context);
    }

    if (
      object.server_ste_metadata &&
      typeof object.server_ste_metadata === "object"
    ) {
      applyServerMetadata(object.server_ste_metadata, context);
    }

    if (object.turn_analytics?.server_ste_metadata) {
      applyServerMetadata(object.turn_analytics.server_ste_metadata, context);
    }

    if (
      ["message_stream_complete", "turn_complete", "response.completed"]
        .includes(String(object.type || ""))
    ) {
      markResponseComplete(context);
    }

    let changed = false;
    let modelCaptured = false;

    const assistantMetadata =
      object.author?.role === "assistant"
        ? object.metadata
        : object.message?.author?.role === "assistant"
          ? object.message?.metadata
          : null;

    if (
      typeof assistantMetadata?.model_slug === "string" &&
      state.assistantModel !== assistantMetadata.model_slug
    ) {
      state.assistantModel = assistantMetadata.model_slug;
      changed = true;
      modelCaptured = true;
    }

    const assistantEffort =
      assistantMetadata?.thinking_effort ??
      assistantMetadata?.reasoning_effort ??
      assistantMetadata?.reasoning?.effort;

    if (assistantEffort !== null && assistantEffort !== undefined) {
      const value = String(assistantEffort);

      if (state.responseThinkingEffort !== value) {
        state.responseThinkingEffort = value;
        changed = true;
      }
    }

    const resolvedModel =
      object.resolved_model_slug ??
      object.metadata?.resolved_model_slug ??
      object.message?.metadata?.resolved_model_slug ??
      (typeof object.resolved_model === "string"
        ? object.resolved_model
        : object.resolved_model?.slug);

    if (typeof resolvedModel === "string" && state.resolvedModel !== resolvedModel) {
      state.resolvedModel = resolvedModel;
      changed = true;
      modelCaptured = true;
    }

    if (
      typeof object.requested_model_experience === "string" &&
      state.requestedExperience !== object.requested_model_experience
    ) {
      state.requestedExperience = object.requested_model_experience;
      changed = true;
    }

    if (changed) {
      if (modelCaptured) {
        markEvidence();
      } else {
        state.updatedAt = Date.now();
      }

      scheduleRender();
    }

    for (const value of Object.values(object)) {
      scanObject(value, context, depth + 1, seen);
    }
  }

  function parseJSONCandidate(text, context) {
    if (!text) return;

    const value = text.trim();
    if (!value) return;

    if (value === "[DONE]") {
      markResponseComplete(context);
      return;
    }

    try {
      scanObject(JSON.parse(value), context);
    } catch {}
  }

  function scanWholeText(text, context = {}) {
    if (!text || typeof text !== "string" || !contextIsCurrent(context)) {
      return;
    }

    try {
      scanObject(JSON.parse(text), context);
    } catch {}

    for (let line of text.split(/\r?\n/)) {
      line = line.trim();
      if (!line) continue;

      if (line.startsWith("data:")) {
        line = line.slice(5).trim();
      }

      parseJSONCandidate(line, context);
    }
  }

  async function watchStream(response, context) {
    if (!response?.body) {
      try {
        scanWholeText(await response.text(), context);
      } catch {}

      markResponseComplete(context);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let eventData = [];

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done || !contextIsCurrent(context)) break;

        buffer += decoder.decode(value, { stream: true });

        let newlineIndex;

        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) {
            line = line.slice(0, -1);
          }

          if (line === "") {
            if (eventData.length) {
              parseJSONCandidate(eventData.join("\n"), context);
              eventData = [];
            }
            continue;
          }

          if (line.startsWith("data:")) {
            const data = line.slice(5).trimStart();
            eventData.push(data);

            // 單行 SSE 立即解析，不必等到下一個空行或串流結束。
            parseJSONCandidate(data, context);
            continue;
          }

          const trimmed = line.trim();

          if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            parseJSONCandidate(trimmed, context);
          }
        }
      }

      buffer += decoder.decode();

      if (buffer.trim()) {
        const rest = buffer.trim();

        if (rest.startsWith("data:")) {
          const data = rest.slice(5).trimStart();
          eventData.push(data);
          parseJSONCandidate(data, context);
        } else {
          parseJSONCandidate(rest, context);
        }
      }

      if (eventData.length) {
        parseJSONCandidate(eventData.join("\n"), context);
      }
    } catch (error) {
      console.debug("[Route Checker] 串流解析中止", error);
    } finally {
      try {
        reader.releaseLock();
      } catch {}

      markResponseComplete(context);
    }
  }

  async function bodyToText(body) {
    try {
      if (body === null || body === undefined) return "";
      if (typeof body === "string") return body;
      if (body instanceof Blob) return await body.text();
      if (body instanceof URLSearchParams) return body.toString();

      if (typeof FormData !== "undefined" && body instanceof FormData) {
        const parts = [];

        for (const [key, value] of body.entries()) {
          if (typeof value === "string") {
            parts.push(`${key}=${value}`);
          } else if (value instanceof Blob) {
            parts.push(`${key}=${await value.text()}`);
          }
        }

        return parts.join("\n");
      }

      if (body instanceof ArrayBuffer) {
        return new TextDecoder().decode(body);
      }

      if (ArrayBuffer.isView(body)) {
        return new TextDecoder().decode(body);
      }
    } catch {}

    return "";
  }

  async function getRequestText(input, init) {
    if (init?.body !== null && init?.body !== undefined) {
      const text = await bodyToText(init.body);
      if (text) return text;
    }

    if (input instanceof Request) {
      try {
        return await input.clone().text();
      } catch {}
    }

    return "";
  }

  function pathnameOf(value) {
    try {
      return new URL(String(value || ""), location.href).pathname;
    } catch {
      return String(value || "").split("?")[0];
    }
  }

  function isConversation(url, method) {
    return (
      method === "POST" &&
      /^\/backend-api\/(?:f\/)?conversation\/?$/.test(pathnameOf(url))
    );
  }

  function isTelemetry(url, method) {
    return (
      method === "POST" &&
      /^\/ces\/v1\/telemetry\/intake\/?$/.test(pathnameOf(url))
    );
  }

  function shouldScanTelemetry(text) {
    if (
      !state.active ||
      !state.startedAt ||
      !text ||
      typeof text !== "string"
    ) {
      return false;
    }

    if (state.turnKey && text.includes(state.turnKey)) return true;

    if (state.conversationId && text.includes(state.conversationId)) {
      return true;
    }

    // v5 會掃描所有遙測。這裡保留五分鐘窗口，避免長回答的
    // server_ste_metadata 因為稍晚送達而被丟棄。
    return Date.now() - state.startedAt <= 300000;
  }

  function scanTelemetryText(text) {
    if (!state.active) return;

    state.telemetrySeen += 1;

    if (shouldScanTelemetry(text)) {
      state.telemetryScanned += 1;

      scanWholeText(text, {
        source: "telemetry",
        generationId: state.generationId
      });
    }

    scheduleRender();
  }

  if (nativeFetch) {
    window.fetch = async function routeCheckerFetch(input, init = {}) {
      const url = typeof input === "string" || input instanceof URL
        ? String(input)
        : input?.url || "";

      const method = String(
        init.method || input?.method || "GET"
      ).toUpperCase();

      const conversationRequest = isConversation(url, method);
      const telemetryRequest = isTelemetry(url, method);

      let requestText = "";
      let generationId = null;
      const requestTextPromise = conversationRequest || telemetryRequest
        ? getRequestText(input, init)
        : Promise.resolve("");

      // 先啟動原始請求，讀取複本時不阻塞 ChatGPT 發送訊息。
      const responsePromise = nativeFetch(input, init);
      void responsePromise.catch(() => {});

      if (conversationRequest || telemetryRequest) {
        requestText = await requestTextPromise;
      }

      if (conversationRequest) {
        try {
          generationId = beginOrUpdateTurn(JSON.parse(requestText));
        } catch {
          generationId = beginOrUpdateTurn({});
        }
      }

      if (telemetryRequest) {
        scanTelemetryText(requestText);
      }

      let response;

      try {
        response = await responsePromise;
      } catch (error) {
        if (conversationRequest && generationId === state.generationId) {
          state.requestError = error?.message || "fetch failed";
          state.updatedAt = Date.now();
          scheduleRender();
        }

        throw error;
      }

      if (conversationRequest) {
        try {
          void watchStream(response.clone(), {
            source: "stream",
            generationId
          });
        } catch {}
      }

      return response;
    };
  }

  if (NativeXHR && nativeXHROpen && nativeXHRSend) {
    NativeXHR.prototype.open = function routeCheckerOpen(method, url, ...rest) {
      this.__routeCheckerMethod = String(method || "GET").toUpperCase();
      this.__routeCheckerUrl = String(url || "");

      return nativeXHROpen.call(this, method, url, ...rest);
    };

    NativeXHR.prototype.send = function routeCheckerSend(body) {
      const url = this.__routeCheckerUrl || "";
      const method = this.__routeCheckerMethod || "GET";
      const conversationRequest = isConversation(url, method);
      const telemetryRequest = isTelemetry(url, method);

      this.__routeCheckerGenerationId = null;

      void bodyToText(body).then(text => {
        if (conversationRequest) {
          try {
            this.__routeCheckerGenerationId = beginOrUpdateTurn(JSON.parse(text));
          } catch {
            this.__routeCheckerGenerationId = beginOrUpdateTurn({});
          }
        }

        if (telemetryRequest) {
          scanTelemetryText(text);
        }
      });

      if (conversationRequest) {
        this.addEventListener("loadend", () => {
          const context = {
            source: "stream",
            generationId: this.__routeCheckerGenerationId || state.generationId
          };

          try {
            if (!this.responseType || this.responseType === "text") {
              scanWholeText(this.responseText, context);
            } else if (this.responseType === "json") {
              scanObject(this.response, context);
            }
          } catch {}

          if (
            this.status === 0 &&
            context.generationId === state.generationId
          ) {
            state.requestError = "xhr failed";
            state.updatedAt = Date.now();
            scheduleRender();
          }

          markResponseComplete(context);
        }, { once: true });
      }

      return nativeXHRSend.call(this, body);
    };
  }

  if (nativeBeacon) {
    const wrappedBeacon = function routeCheckerBeacon(url, data) {
      const target = String(url || "");

      if (isTelemetry(target, "POST")) {
        void bodyToText(data).then(text => {
          scanTelemetryText(text);
        });
      }

      return nativeBeacon(url, data);
    };

    try {
      navigator.sendBeacon = wrappedBeacon;
    } catch {
      try {
        Object.defineProperty(navigator, "sendBeacon", {
          configurable: true,
          value: wrappedBeacon
        });
      } catch {}
    }
  }

  function handleDomMutations(records) {
    if (!state.active) return;

    for (let recordIndex = records.length - 1; recordIndex >= 0; recordIndex -= 1) {
      const record = records[recordIndex];

      if (record.type === "attributes") {
        if (applyDomCandidate(assistantCandidateFromElement(record.target))) {
          scheduleRender();
          return;
        }

        continue;
      }

      const addedNodes = record.addedNodes || [];

      for (let nodeIndex = addedNodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
        if (applyDomCandidate(assistantCandidateFromElement(addedNodes[nodeIndex]))) {
          scheduleRender();
          return;
        }
      }
    }
  }

  const domObserver = new MutationObserver(handleDomMutations);

  domObserver.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-message-model-slug"]
  });

  let themeObserver = null;

  function observeTheme() {
    if (!document.documentElement || themeObserver) return;

    themeObserver = new MutationObserver(syncTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-color-scheme"]
    });
  }

  const darkModeQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
  darkModeQuery?.addEventListener?.("change", syncTheme);

  window.addEventListener("resize", () => {
    applyAnchor();
    requestAnimationFrame(clampHost);
  }, { passive: true });

  document.addEventListener("readystatechange", () => {
    mountHost();
    observeTheme();
  });

  window.__CHATGPT_ROUTE_CHECK_STATE__ = state;
  window.__CHATGPT_ROUTE_CHECKER__ = Object.freeze({
    version: VERSION,
    snapshot,
    expand() {
      state.uiMinimized = false;
      writeBoolean(STORAGE.minimized, false);
      scheduleRender();
    },
    minimize() {
      state.uiMinimized = true;
      writeBoolean(STORAGE.minimized, true);
      scheduleRender();
    },
    resetPosition
  });

  mountHost();
  observeTheme();
  render();

  console.info(`[Route Checker] v${VERSION} 已啟動`);
})();
