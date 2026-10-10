# Glossary

## Statement adapter

The internal cmi5 module that accepts a player-emitted xAPI Activity statement only when its
`context.platform` is present, keeping `context.revision` when the player had one to give (a
statement released before the index answered has none), then applies the cmi5 launch
actor, registration, context template, identifier, and timestamp. It reports and drops malformed
or non-Activity statements without ending the cmi5 session.

## Ready phase

The internal cmi5 module that buffers player statements and the first completion outcome while
the launch handshakes, releases them after `initialized`, and drops later input once the session
stops.

## Simulated LMS transport

The demo's in-memory transport adapter for the cmi5 client. It supplies a launch token, launch
data and empty LRS history, then records each posted statement in the page log. It does not build
cmi5 statements itself, so the demo and network launch share the same construction rules.