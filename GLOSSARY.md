# Glossary

## Statement adapter

The internal cmi5 module that accepts a player-emitted xAPI Activity statement only when its
`context.revision` and `context.platform` provenance are present, then applies the cmi5 launch
actor, registration, context template, identifier, and timestamp. It reports and drops malformed
or non-Activity statements without ending the cmi5 session.

## Ready phase

The internal cmi5 module that buffers player statements and the first completion outcome while
the launch handshakes, releases them after `initialized`, and drops later input once the session
stops.