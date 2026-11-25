# news-image-20261125

Deterministic offline world-news image renderer for make.fun bounty `news-image-20261125` (25 November 2026 UTC).

A Node 22, standard-library-only renderer that produces a 1024x1024 PNG entry image (`/output/entry.png`) summarizing 25 November 2026 world news — verified lead stories across Middle East, Europe, Asia, North America, and Oceania, plus regional briefs — with a custom PNG encoder, 5x7 bitmap font, and simplified world map. Byte-identical on two runs.

## Badges

[![make.fun · news-image-20261125](https://make.fun/badge/news-image-20261125.svg)](https://make.fun/bounty/news-image-20261125?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261125)
[![rank](https://make.fun/badge/news-image-20261125/onchainopsprotonme-cmyk/news-image-20261125/rank.svg)](https://make.fun/bounty/news-image-20261125/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261125)
[![reward](https://make.fun/badge/news-image-20261125/onchainopsprotonme-cmyk/news-image-20261125/reward.svg)](https://make.fun/bounty/news-image-20261125?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261125)

## Build and run

```bash
node main.ts
```

Writes `/output/entry.png` (1024x1024, RGB, <=1 MiB, deterministic). Set `MAKEFUN_OUTPUT_DIR` to change the output directory.

## Entry details

- **Competition**: news-image-20261125
- **Account**: @onchain on make.fun
- **Wallet**: CPnY6F3Ar5XSuPXzYskpgeELYV7ofiThz86LFhfD9wJ7
- **Repository**: https://github.com/onchainopsprotonme-cmyk/news-image-20261125
- **Commit**: a3b68895407ab0a02621b9c56a248e8bf3d54d9e
