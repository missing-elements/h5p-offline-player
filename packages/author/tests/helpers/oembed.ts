// The tests never ask YouTube or Vimeo whether they have a video (#218): a build of a hosted
// video's address hears that they do, unless a test passes a `fetch` of its own to say otherwise.
const ask = /^https:\/\/(?:www\.youtube\.com\/oembed|vimeo\.com\/api\/oembed\.json)\?/
const real = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input)
  return ask.test(url) ? Promise.resolve(Response.json({ type: 'video' })) : real(input, init)
}
