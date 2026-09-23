/**
 * Proof that a dependency named only by the library bundle gets loaded. A content-only export
 * lists just its main library, so without merging the two manifests this script never runs —
 * which in a real Interactive Video is the difference between playing and "Unable to find
 * constructor for: H5P.Text".
 */
window.h5pOfflineExtraLoaded = true;
