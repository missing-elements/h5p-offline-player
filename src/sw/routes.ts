/**
 * URL shape of the virtual routes. Our own registration uses the scope `<swDir>h5p/`, so routes
 * sit directly under it; `mountH5P` puts them at `<hostScope>h5p/`. Both spell the same thing —
 * `…/h5p/virtual/…` and `…/h5p/frame/…` — so everything downstream works off one base.
 */

export interface Routes {
  /** Absolute URL prefix, always ending in `h5p/`. */
  base: string
  virtual: string
  frame: string
  ping: string
}

export function routesFor(scope: string): Routes {
  const normalizedScope = scope.endsWith('/') ? scope : `${scope}/`
  const base = normalizedScope.endsWith('h5p/') ? normalizedScope : `${normalizedScope}h5p/`

  return {
    base,
    virtual: `${base}virtual/`,
    frame: `${base}frame/`,
    ping: `${base}virtual/_ping`
  }
}

export type RouteMatch =
  | { kind: 'ping' }
  | { kind: 'frame'; pkgId: string }
  | { kind: 'entry'; pkgId: string; path: string }
  | { kind: 'none' }

const PKG_ID = /^[0-9a-f]{32}$/

export function matchRoute(routes: Routes, url: string): RouteMatch {
  if (url === routes.ping) return { kind: 'ping' }

  if (url.startsWith(routes.frame)) {
    const pkgId = url.slice(routes.frame.length).split(/[/?#]/, 1)[0]
    return PKG_ID.test(pkgId) ? { kind: 'frame', pkgId } : { kind: 'none' }
  }

  if (url.startsWith(routes.virtual)) {
    const rest = url.slice(routes.virtual.length).split(/[?#]/, 1)[0]
    const slash = rest.indexOf('/')
    if (slash < 0) return { kind: 'none' }

    const pkgId = rest.slice(0, slash)
    if (!PKG_ID.test(pkgId)) return { kind: 'none' }

    return { kind: 'entry', pkgId, path: rest.slice(slash + 1) }
  }

  return { kind: 'none' }
}
