/**
 * The site's pages: what `vite.config.ts` builds and what `build-demo.mjs` lists in the sitemap,
 * from one list, so a page added to one is not missing from the other. `indexed: false` keeps a
 * page out of the sitemap: `/embed` carries `noindex`.
 */
export const PAGES = [
  { name: 'index', file: 'index.html', path: '/' },
  { name: 'app', file: 'app/index.html', path: '/app/' },
  { name: 'embed', file: 'embed.html', path: '/embed', indexed: false },
  { name: 'demo', file: 'demo/index.html', path: '/demo/' },
  { name: 'setup', file: 'demo/setup.html', path: '/demo/setup.html' },
  { name: 'compare', file: 'demo/compare.html', path: '/demo/compare.html' },
  { name: 'normalize', file: 'demo/normalize.html', path: '/demo/normalize.html' },
  { name: 'xapi', file: 'demo/xapi.html', path: '/demo/xapi.html' },
  { name: 'cmi5', file: 'demo/cmi5.html', path: '/demo/cmi5.html' },
  { name: 'local-file', file: 'demo/local-file.html', path: '/demo/local-file.html' },
  { name: 'two-players', file: 'demo/two-players.html', path: '/demo/two-players.html' },
  { name: 'demo-embed', file: 'demo/embed.html', path: '/demo/embed.html' }
]
