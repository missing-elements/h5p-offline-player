/**
 * The smallest content type that still exercises the parts the player cares about: it is loaded
 * from the archive by the virtual file server, its CSS has to arrive as `text/css` to apply, and
 * it emits a real xAPI statement through H5P's own dispatcher.
 */
var H5P = H5P || {};

H5P.OfflineTest = (function ($) {
  function OfflineTest(params, contentId) {
    H5P.EventDispatcher.call(this);
    this.params = params || {};
    this.contentId = contentId;
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

    $button.on('click', function () {
      self.triggerXAPIScored(1, 1, 'completed');
    });

    $container.append($message).append($button);

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

  return OfflineTest;
})(H5P.jQuery);
