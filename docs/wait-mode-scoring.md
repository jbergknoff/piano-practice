# Wait Mode Scoring

Wait mode assigns a score of 0–100% at the end of each attempt, combining accuracy (weighted more heavily) with tempo.

## Formula

```
score = round(0.7 × accuracy + 0.3 × tempo)

accuracy = max(0, 1 − wrongNotes / totalPoints)
tempo    = min(1, expectedDurationMs / elapsedMs)
```

- **accuracy** — fraction of wait points reached without a wrong note. `totalPoints` is the number of distinct chords (wait points) in the selection; each wrong note press outside the grace period increments `wrongNotes` by one.
- **tempo** — ratio of the expected duration (at the piece's marked BPM) to the actual elapsed time, capped at 1. Playing at or faster than the marked tempo gives full credit; playing at twice the expected duration gives 0.5.

## Weights

| Component | Weight | Rationale |
|-----------|--------|-----------|
| Accuracy  | 70%    | Correctness is the primary goal |
| Tempo     | 30%    | Speed matters, but shouldn't dominate |

A perfect-accuracy slow run always outscores a fast run with many errors:

| Wrong notes | Elapsed vs. expected | Accuracy | Tempo | Score |
|-------------|----------------------|----------|-------|-------|
| 0 | 1× | 100% | 100% | **100%** |
| 0 | 2× | 100% | 50% | **85%** |
| 0 | 4× | 100% | 25% | **78%** |
| 10% of total | 1× | 90% | 100% | **93%** |
| 10% of total | 2× | 90% | 50% | **78%** |
| 50% of total | 1× | 50% | 100% | **65%** |

## Notes

- There is no separate per-tempo leaderboard in wait mode (unlike playalong mode). The single score reflects both accuracy and pace together.
- `expectedDurationMs` is derived from the piece's marked BPM and the number of beats in the selection; it does not change with the BPM slider.
- The grace period (default 150 ms after each successful advance) suppresses spurious wrong-note counts from key-release events of the previous chord; those events are ignored and do not affect the score.
