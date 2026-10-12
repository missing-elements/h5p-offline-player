/**
 * The fixture content type's upgrade steps, written the way a real library writes them. Each step
 * appends its version to the message, so the text says which steps ran and in what order; content
 * that sets `failUpgrade` makes the first one throw, for the case that has to fall back.
 */
var H5PUpgrades = H5PUpgrades || {};

H5PUpgrades['H5P.OfflineTest'] = (function () {
  return {
    1: {
      1: function (parameters, finished) {
        if (parameters.failUpgrade) {
          throw new Error('The fixture step to 1.1 fails on purpose');
        }
        parameters.message += ' [1.1]';
        finished(null, parameters);
      },
      2: {
        contentUpgrade: function (parameters, finished) {
          parameters.message += ' [1.2]';
          finished(null, parameters);
        }
      }
    }
  };
})();
