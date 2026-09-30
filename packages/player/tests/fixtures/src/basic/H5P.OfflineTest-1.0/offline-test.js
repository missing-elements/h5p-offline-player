/**
 * The smallest content type that still exercises the parts the player cares about: it is loaded
 * from the archive by the virtual file server, its CSS has to arrive as `text/css` to apply, it
 * emits a real xAPI statement through H5P's own dispatcher, and it has a state to save and
 * resume — how many times Complete was pressed — the way a real content type does it:
 * `getCurrentState()` for the runtime to save, `extras.previousState` to start from.
 */
var H5P = H5P || {};

H5P.OfflineTest = (function ($) {
  function OfflineTest(params, contentId, extras) {
    H5P.EventDispatcher.call(this);
    this.params = params || {};
    this.contentId = contentId;
    var previous = extras && extras.previousState;
    this.clicks = previous && typeof previous.clicks === 'number' ? previous.clicks : 0;
  }

  OfflineTest.prototype = Object.create(H5P.EventDispatcher.prototype);
  OfflineTest.prototype.constructor = OfflineTest;

  OfflineTest.prototype.attach = function ($container) {
    var self = this;

    $container.addClass('h5p-offline-test');
    $container.html('');

    var $message = $('<p class="h5p-offline-test-message"></p>').text(
      self.params.message || 'H5P offline test'
    );
    var $button = $('<button class="h5p-offline-test-complete" type="button">Complete</button>');
    var $count = $('<span class="h5p-offline-test-count"></span>').text(String(self.clicks));

    $button.on('click', function () {
      self.clicks += 1;
      $count.text(String(self.clicks));
      self.triggerXAPIScored(1, 1, 'completed');
    });

    $container.append($message).append($button).append($count);

    if (self.params.media && self.params.media.path) {
      var source = H5P.getPath(self.params.media.path, self.contentId);
      $container.append(
        $('<video class="h5p-offline-test-media" controls preload="metadata"></video>').attr(
          'src',
          source
        )
      );
    }
  };

  /** Nothing to save until Complete has been pressed, as H5P's own content types do it. */
  OfflineTest.prototype.getCurrentState = function () {
    return this.clicks > 0 ? { clicks: this.clicks } : undefined;
  };

  return OfflineTest;
})(H5P.jQuery);
