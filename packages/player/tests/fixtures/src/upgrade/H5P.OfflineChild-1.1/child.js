/** Sub-content that shows its text, so a test can read what the upgrade made of it. */
var H5P = H5P || {};

H5P.OfflineChild = (function ($) {
  function OfflineChild(params) {
    this.params = params || {};
  }

  OfflineChild.prototype.attach = function ($container) {
    $container.append($('<p class="h5p-offline-child-text"></p>').text(this.params.text || 'Offline child'));
  };

  return OfflineChild;
})(H5P.jQuery);
