var H5PUpgrades = H5PUpgrades || {};

H5PUpgrades['H5P.OfflineChild'] = (function () {
  return {
    1: {
      1: function (parameters, finished) {
        parameters.text += ' [child 1.1]';
        finished(null, parameters);
      }
    }
  };
})();
