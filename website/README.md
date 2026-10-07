# Asterveil website

Live: https://asterveil.yxyx.space/

Alternate: https://asterveil-beta.vercel.app/

Vercel project: https://vercel.com/destinylesnowyx-5741s-projects/asterveil

Standalone static introduction site. The brand mark reuses the exact path from
`../public/icon/asterveil.svg`; SVG light trails respond to pointer movement.
Clicking empty space triggers a short light pulse. Reduced-motion preferences
disable motion, and animation pauses while the page is hidden.

## Local development

Requires Node.js; no package dependencies or installation are needed.

```sh
cd website
npm run dev
```

Preview: http://127.0.0.1:4173/

```sh
npm run build
```

Build output: `dist/`.

## Deployment

Vercel is connected to `DestinyleSnowy/Asterveil`, with Root Directory set to
`website`. Push website changes to `main` to update the production website;
other branches create preview deployments. The configured build command is
`npm run build`, with output `dist`. Dependency installation is explicitly
skipped because this static website has no dependencies.

The first deployment was uploaded through Vercel Drop on 2026-10-03, before
connecting GitHub. The existing production domain is retained.

The browser extension retains its separate root build configuration.

## Verification

- Production status: Ready; public homepage loads without console errors.
- Local build and JavaScript syntax checks passed.
- Desktop and 390 × 844 mobile layouts inspected, without horizontal overflow.
- Pointer deformation, click pulse, and reduced-motion behavior checked in-browser.

Download and installation links point to the existing GitHub releases and README.
