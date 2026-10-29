# Changelog

## 0.3.0

VS Code plays video and audio with fewer codecs than a browser: an MP4's sound, M4A audio, WebM
and YouTube do not play in its editor. A line under the bar now says which of these a package has,
"VS Code plays its MP4 video without sound and cannot play its WebM video", with an Open in Browser
button that plays it in full. The bar no longer shows a bare "U" for a package whose licence is
undisclosed. Player 1.2.0 inside, as in 0.2.0.

## 0.2.0

Content made for a newer version of a library than the package and the library pack carry, such
as an h5p.com export ahead of the H5P hub, plays on the newest older minor of the same major
instead of being refused. The bar says so, "one library older than the content", and its tooltip
names each one: "H5P.MultiChoice made for 1.17, played at 1.16.27". Player 1.2.0 inside.

## 0.1.1

Vimeo videos play. The frame's policy now admits the oEmbed record Vimeo's player reads before
it starts, which the player inside 0.1.0 refused, so every Vimeo video ended in a loading error.
Timeline's Wikipedia, Vimeo, SoundCloud and Flickr items load the same way. Player 1.1.2 inside.

## 0.1.0

The first release. A `.h5p` opens in an editor that plays it with the library pack carried
inside, with Untrusted and Newest libraries switches, Restricted Mode playing every package
untrusted, Reload, Open in Browser, and a new play when the file changes.
