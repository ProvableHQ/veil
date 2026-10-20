# Veil documentation site

The [Veil Aleo TypeScript SDK documentation](https://provablehq.github.io/veil/)
is built with Docusaurus. Guides and API references live in `docs/`;
`sidebars.ts` controls navigation.

## Local development

```bash
cd site
npm ci
npm start
```

## Verification

```bash
npm run typecheck
npm run build
```

The production build writes static HTML, canonical links, page descriptions,
and `sitemap.xml` into `build/`. Each package has a page under `docs/packages/`;
keep its title and description aligned with the package README and npm metadata.

`static/llms.txt` links to the repository's root `llms.txt`, so both entry points
use the same curated Markdown index. Update that index when adding a package or
moving a linked guide. The site advertises it through a `rel="describedby"` link
and the footer.

## Deployment

The Docs GitHub Actions workflow builds and deploys the site to GitHub Pages
on `main` when the site or indexed package documentation changes.
The default URL is `https://provablehq.github.io/veil/`. A custom deployment can
set `DOCS_URL` and `DOCS_BASE_URL` at build time; the base path must start and end
with `/`. These values also control canonical URLs and sitemap locations.

The sitemap is available at `<DOCS_URL><DOCS_BASE_URL>sitemap.xml`, and the
agent index at `<DOCS_URL><DOCS_BASE_URL>llms.txt`. Any `robots.txt` policy must
be served at the hosting origin's root, rather than the `/veil/` project path.

Package descriptions, keywords, homepage links, and issue links are defined
in each package's `package.json`; npm displays them after that package is published.
