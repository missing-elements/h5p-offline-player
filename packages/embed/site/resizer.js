/*! h5p-offline-player resizer. MIT. Sizes an <iframe> of the H5P embed page to its content. */
/**
 * The page-side half of H5P's resizer protocol, for a page that frames the embed page
 * (`@missing-elements/h5p-embed`). The frame can only report its height upward, by
 * `postMessage`, and something on the page has to apply it:
 * this script, in one line, or h5p.org's own `h5p-resizer.js`, which speaks the same protocol.
 * This one is served from the player's origin, so an embedding page sends nothing to a third
 * party and does not depend on a path on h5p.org.
 *
 *   <script src="https://<player origin>/resizer.js"></script>
 *
 * It answers every frame on the page that speaks the protocol, which is also what h5p.org's
 * script does: a frame can only ever ask for the height of itself. Classic script, no module,
 * so it runs wherever an embed block runs.
 */
(function () {
  if (window.__h5pResizer) return;
  window.__h5pResizer = true;

  var frameOf = function (source) {
    var frames = document.getElementsByTagName('iframe');
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === source) return frames[i];
    }
    return null;
  };

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.context !== 'h5p' || !event.source) return;
    var frame = frameOf(event.source);
    if (!frame) return;
    switch (data.action) {
      case 'hello':
        // The frame asks whether anyone is listening; the reply makes it start reporting.
        event.source.postMessage({ context: 'h5p', action: 'hello' }, event.origin);
        break;
      case 'prepareResize':
        // The frame is about to measure itself; it wants the box no larger than its content.
        if (typeof data.scrollHeight === 'number' && frame.clientHeight !== data.scrollHeight) {
          frame.style.height = data.scrollHeight + 'px';
        }
        event.source.postMessage({ context: 'h5p', action: 'resizePrepared' }, event.origin);
        break;
      case 'resize':
        if (typeof data.scrollHeight === 'number') frame.style.height = data.scrollHeight + 'px';
        break;
    }
  });

  // A frame that loaded before this script said its hello to nobody; tell every frame the
  // listener is here, and the ones that speak the protocol say hello again.
  var announce = function () {
    var frames = document.getElementsByTagName('iframe');
    for (var i = 0; i < frames.length; i++) {
      try { frames[i].contentWindow.postMessage({ context: 'h5p', action: 'ready' }, '*'); } catch (e) { /* not ours */ }
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', announce);
  else announce();
})();
