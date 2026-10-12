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

/**
 * A package as one load plays it: the archive's id, and the load's key, under which the worker
 * keeps what that load asked for (`LoadSettings`). No key is a frame an older element opened.
 */
export interface LoadRef {
  pkgId: string
  view?: string
}

export type RouteMatch =
  | { kind: 'ping' }
  | ({ kind: 'frame' } & LoadRef)
  | ({ kind: 'entry'; path: string } & LoadRef)
  | { kind: 'none' }

/** The 32 hex characters of a package id, and the 16 of a load key after a hyphen. */
const LOAD_ID = /^([0-9a-f]{32})(?:-([0-9a-f]{16}))?$/

/** The path segment the routes name a load by: `<pkgId>` or `<pkgId>-<view>`. */
export function loadSegment({ pkgId, view }: LoadRef): string {
  return view ? `${pkgId}-${view}` : pkgId
}

function parseLoad(segment: string): LoadRef | null {
  const match = LOAD_ID.exec(segment)
  if (!match) return null
  return match[2] ? { pkgId: match[1], view: match[2] } : { pkgId: match[1] }
}

export function matchRoute(routes: Routes, url: string): RouteMatch {
  if (url === routes.ping) return { kind: 'ping' }

  if (url.startsWith(routes.frame)) {
    const load = parseLoad(url.slice(routes.frame.length).split(/[/?#]/, 1)[0])
    return load ? { kind: 'frame', ...load } : { kind: 'none' }
  }

  if (url.startsWith(routes.virtual)) {
    const rest = url.slice(routes.virtual.length).split(/[?#]/, 1)[0]
    const slash = rest.indexOf('/')
    if (slash < 0) return { kind: 'none' }

    const load = parseLoad(rest.slice(0, slash))
    if (!load) return { kind: 'none' }

    return { kind: 'entry', ...load, path: rest.slice(slash + 1) }
  }

  return { kind: 'none' }
}
