import { useEffect, useRef, useState } from "react";
import { puzzleLink, type ShareMode } from "../utils/shareLink";

/** "Puzzle #N" label that copies a link to this mode + puzzle when clicked. */
export default function PuzzleLinkButton({
  mode,
  printDate,
  puzzleNumber,
}: {
  mode: ShareMode;
  printDate: string;
  puzzleNumber: number;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const onClick = async () => {
    const link = puzzleLink(mode, printDate);
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Clipboard API unavailable (insecure context, denied permission, etc.)
      try {
        window.prompt("Copy this link:", link);
      } catch {
        // ignore
      }
      return;
    }
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      className="nytMetaItem nytPuzzleLink"
      type="button"
      onClick={onClick}
      title="Copy link to this puzzle"
    >
      <span aria-live="polite">
        {copied ? "Link copied!" : `Puzzle #${puzzleNumber}`}
      </span>
    </button>
  );
}
