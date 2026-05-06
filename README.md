# Iu Mienh Translator

A web-based English → Iu Mienh translator and dictionary browser.

## Features
- **Translate**: Type English text and get word-by-word Iu Mienh translations
- **Dictionary**: Browse and search ~5,800 English→Iu Mienh word entries
- Longest-match-first phrase detection
- Hover tooltips showing full definitions and usage notes
- Mobile-responsive design

## Tech Stack
- Pure HTML/CSS/JS (no build step, no framework)
- Static JSON dictionary (loaded client-side)
- Deployable to any static hosting (Netlify, Vercel, GitHub Pages)

## Deployment

### Netlify
1. Push to GitHub
2. Connect repo to Netlify
3. Set publish directory to `/` (root)
4. Deploy!

### GitHub Pages
1. Push to GitHub
2. Go to Settings → Pages
3. Select branch `main` and root `/`
4. Save

### Local Development
Just open `index.html` in a browser, or serve with:
```bash
npx serve .
```

## Dictionary Source
Extracted from "A Dictionary Tool" PDF (61 pages, ~5,800 entries).
The `extract-dictionary.mjs` script handles PDF→JSON conversion.

## Future Improvements
- [ ] LLM-augmented sentence translation (for grammatically-aware output)
- [ ] Reverse lookup (Iu Mienh → English)
- [ ] Audio pronunciation
- [ ] User-contributed corrections
