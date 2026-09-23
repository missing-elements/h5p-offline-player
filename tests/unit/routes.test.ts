import { describe, expect, it } from 'vitest'
import { matchRoute, routesFor } from '../../src/sw/routes'

const PKG = 'a'.repeat(32)

describe('routesFor', () => {
  it('uses our own registration scope as it is, since it already ends in h5p/', () => {
    const routes = routesFor('https://site.example/assets/h5p/')
    expect(routes.base).toBe('https://site.example/assets/h5p/')
    expect(routes.virtual).toBe('https://site.example/assets/h5p/virtual/')
  })

  it('adds the prefix under a host scope, for a worker we were mounted into', () => {
    const routes = routesFor('https://site.example/')
    expect(routes.base).toBe('https://site.example/h5p/')
    expect(routes.frame).toBe('https://site.example/h5p/frame/')
  })

  it('tolerates a scope without a trailing slash', () => {
    expect(routesFor('https://site.example/app').base).toBe('https://site.example/app/h5p/')
  })
})

describe('matchRoute', () => {
  const routes = routesFor('https://site.example/assets/h5p/')

  it('matches the ping route the element uses to find mounted routes', () => {
    expect(matchRoute(routes, routes.ping)).toEqual({ kind: 'ping' })
  })

  it('matches a frame navigation', () => {
    expect(matchRoute(routes, `${routes.frame}${PKG}`)).toEqual({ kind: 'frame', pkgId: PKG })
  })

  it('matches an entry request and keeps the whole path', () => {
    expect(matchRoute(routes, `${routes.virtual}${PKG}/content/images/a.png`)).toEqual({
      kind: 'entry',
      pkgId: PKG,
      path: 'content/images/a.png'
    })
  })

  it('drops the query string, which H5P appends as a cache buster', () => {
    expect(matchRoute(routes, `${routes.virtual}${PKG}/h5p.json?v=2`)).toEqual({
      kind: 'entry',
      pkgId: PKG,
      path: 'h5p.json'
    })
  })

  it.each([
    'https://site.example/assets/h5p/virtual/not-a-pkg-id/h5p.json',
    'https://site.example/assets/h5p/virtual/',
    `https://site.example/assets/h5p/virtual/${PKG}`,
    'https://youtube.com/embed/abc',
    'https://site.example/assets/other.js'
  ])('leaves %s to the network', (url) => {
    expect(matchRoute(routes, url)).toEqual({ kind: 'none' })
  })

  it('does not match a scope that merely starts the same way', () => {
    const other = routesFor('https://site.example/assets/h5p-other/')
    expect(matchRoute(routes, `${other.virtual}${PKG}/h5p.json`)).toEqual({ kind: 'none' })
  })
})
