/**
 * Expand MusicXML repeat sections into a flat, linear measure sequence.
 *
 * Supports:
 *   - Simple repeats  |: ... :|   (plays the section N times; default 2)
 *   - Volta brackets  |: ... |1.| :| |2.| ...  (1st / 2nd endings)
 *   - Implicit repeat start (backward-repeat with no prior forward-repeat
 *     jumps back to the beginning of the piece, or to just after the
 *     previous backward-repeat barline).
 *   - Multiple non-nested repeat sections in a row.
 *
 * The expanded XML has the repeated measures duplicated in document order
 * with renumbered `number` attributes and stripped `<repeat>` / `<ending>`
 * barline children so downstream code sees a plain linear score.
 */

interface MeasureRepeatInfo {
  /** True when this measure has a left-barline `<repeat direction="forward">`. */
  hasForwardRepeat: boolean;
  /** True when this measure has a right-barline `<repeat direction="backward">`. */
  hasBackwardRepeat: boolean;
  /** Times to play the repeated section (from the backward-repeat `times` attr; default 2). */
  repeatTimes: number;
  /**
   * Which volta-ending numbers this measure belongs to (empty = no ending, plays
   * on every pass).  Populated by scanning `<ending>` elements and carrying the
   * open-ending state forward across multi-measure endings.
   */
  endingNumbers: number[];
}

/** Extract per-measure repeat metadata from an array of `<measure>` Elements. */
function extractRepeatInfos(measureEls: Element[]): MeasureRepeatInfo[] {
  // ── Phase 1: compute ending-number spans ────────────────────────────────
  const endingNumbersByMeasure: number[][] = measureEls.map(() => []);
  let openEnding: { numbers: number[] } | null = null;

  for (let i = 0; i < measureEls.length; i++) {
    let closedHere = false;

    for (const barline of Array.from(
      measureEls[i].querySelectorAll("barline"),
    )) {
      const endingEl = barline.querySelector("ending");
      if (!endingEl) {
        continue;
      }

      const type = endingEl.getAttribute("type") ?? "start";
      const numStr = endingEl.getAttribute("number") ?? "1";
      const numbers = numStr
        .split(/[\s,]+/)
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0);

      if (type === "start") {
        openEnding = { numbers };
      } else if (type === "stop" || type === "discontinue") {
        closedHere = true;
      }
    }

    if (openEnding) {
      endingNumbersByMeasure[i] = openEnding.numbers;
    }
    if (closedHere) {
      openEnding = null;
    }
  }

  // ── Phase 2: extract per-measure forward/backward repeat markers ─────────
  return measureEls.map((m, i) => {
    let hasForwardRepeat = false;
    let hasBackwardRepeat = false;
    let repeatTimes = 2;

    for (const barline of Array.from(m.querySelectorAll("barline"))) {
      const repeatEl = barline.querySelector("repeat");
      if (!repeatEl) {
        continue;
      }

      const dir = repeatEl.getAttribute("direction");
      if (dir === "forward") {
        hasForwardRepeat = true;
      } else if (dir === "backward") {
        hasBackwardRepeat = true;
        const timesAttr = repeatEl.getAttribute("times");
        if (timesAttr) {
          const t = Number.parseInt(timesAttr, 10);
          if (t > 0) {
            repeatTimes = t;
          }
        }
      }
    }

    return {
      hasForwardRepeat,
      hasBackwardRepeat,
      repeatTimes,
      endingNumbers: endingNumbersByMeasure[i],
    };
  });
}

/**
 * Given per-measure repeat metadata, return the flat ordered list of original
 * measure indices that represents the fully-expanded playback sequence.
 */
export function computeExpansion(infos: MeasureRepeatInfo[]): number[] {
  const n = infos.length;

  // Fast path: nothing to expand.
  if (!infos.some((m) => m.hasBackwardRepeat)) {
    return infos.map((_, i) => i);
  }

  const result: number[] = [];

  interface Ctx {
    startIndex: number;
    timesTotal: number;
    pass: number; // 0 = first play-through, 1 = first repeat, …
  }
  const stack: Ctx[] = [];

  let i = 0;
  while (i < n) {
    const info = infos[i];

    // ── Open a new repeat section ──────────────────────────────────────────
    if (info.hasForwardRepeat) {
      // Only push a new context if we are not already tracking this start
      // index (i.e. we are here because of a jump-back, not a first visit).
      const alreadyTracked = stack.some((c) => c.startIndex === i);
      if (!alreadyTracked) {
        stack.push({ startIndex: i, timesTotal: 2, pass: 0 });
      }
    }

    // ── Volta bracket: skip this measure if it is for the wrong pass ───────
    if (info.endingNumbers.length > 0 && stack.length > 0) {
      const ctx = stack[stack.length - 1];
      // On pass 0 we play ending 1, on pass 1 we play ending 2, etc.
      const expectedVolta = ctx.pass + 1;
      if (!info.endingNumbers.includes(expectedVolta)) {
        // Advance past all measures that don't belong to our current pass.
        i++;
        while (i < n) {
          const ni = infos[i];
          if (
            ni.endingNumbers.length === 0 ||
            ni.endingNumbers.includes(expectedVolta)
          ) {
            break;
          }
          i++;
        }
        continue;
      }
    }

    result.push(i);

    // ── Close / loop a repeat section ──────────────────────────────────────
    if (info.hasBackwardRepeat) {
      if (stack.length === 0) {
        // Implicit forward repeat: find where this section began (just after
        // the previous backward-repeat, or the start of the piece).
        let implicitStart = 0;
        for (let k = i - 1; k >= 0; k--) {
          if (infos[k].hasBackwardRepeat) {
            implicitStart = k + 1;
            break;
          }
        }
        stack.push({
          startIndex: implicitStart,
          timesTotal: info.repeatTimes,
          pass: 0,
        });
      }

      const ctx = stack[stack.length - 1];
      // Update timesTotal from the actual backward-repeat marker (may differ
      // from our initial push default of 2).
      ctx.timesTotal = info.repeatTimes;
      ctx.pass++;

      if (ctx.pass < ctx.timesTotal) {
        // Jump back to the start of this repeat section.
        i = ctx.startIndex;
        continue;
      }

      // Finished repeating this section.
      stack.pop();
    }

    i++;
  }

  return result;
}

/** Remove `<repeat>` and `<ending>` children from every `<barline>` in a measure. */
function stripRepeatBarlines(measureEl: Element): void {
  for (const barline of Array.from(measureEl.querySelectorAll("barline"))) {
    for (const child of Array.from(
      barline.querySelectorAll("repeat, ending"),
    )) {
      barline.removeChild(child);
    }
    // If the barline is now empty, remove it entirely.
    if (barline.children.length === 0 && barline.textContent?.trim() === "") {
      barline.parentNode?.removeChild(barline);
    }
  }
}

/** Serialize a DOM document back to an XML string (works in both browser and test environments). */
function serializeDom(doc: Document): string {
  if (typeof XMLSerializer !== "undefined") {
    return new XMLSerializer().serializeToString(doc);
  }
  // Fallback for linkedom (test environment) which provides outerHTML but not XMLSerializer.
  const root = doc.documentElement as unknown as { outerHTML: string };
  return root.outerHTML ?? "";
}

/**
 * Given a MusicXML string, return a new MusicXML string with all repeat
 * sections expanded into a flat linear measure sequence.  If the score
 * contains no repeat markers the original string is returned unchanged.
 */
export function expandRepeatsMusicXml(xml: string): string {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "text/xml");
  } catch {
    return xml;
  }
  if (doc.querySelector("parsererror")) {
    return xml;
  }

  const partEls = Array.from(doc.querySelectorAll("score-partwise > part"));
  if (partEls.length === 0) {
    return xml;
  }

  // Derive the expansion from the first part (all parts share the same structure).
  const firstMeasures = Array.from(partEls[0].querySelectorAll("measure"));
  if (firstMeasures.length === 0) {
    return xml;
  }

  const infos = extractRepeatInfos(firstMeasures);
  const expandedIndices = computeExpansion(infos);

  // No-op if the expanded sequence is identical to the original.
  if (
    expandedIndices.length === firstMeasures.length &&
    expandedIndices.every((v, i) => v === i)
  ) {
    return xml;
  }

  // Apply the same expansion to every part.
  for (const partEl of partEls) {
    const measureEls = Array.from(partEl.querySelectorAll("measure"));

    // Remove all original measures.
    for (const m of measureEls) {
      partEl.removeChild(m);
    }

    // Re-insert in expanded order.
    for (let newIdx = 0; newIdx < expandedIndices.length; newIdx++) {
      const origIdx = expandedIndices[newIdx];
      const source = measureEls[origIdx];
      if (!source) {
        continue;
      }

      const cloned = source.cloneNode(true) as Element;
      cloned.setAttribute("number", String(newIdx + 1));
      stripRepeatBarlines(cloned);
      partEl.appendChild(cloned);
    }
  }

  return serializeDom(doc);
}
