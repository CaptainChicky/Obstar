/*
  Late-bound registry for the pieces of the game server that reference each other in a cycle.

  The dependency graph here is genuinely circular and always has been - entities call into
  Controller, rooms construct entities, Main constructs rooms, and the AI closes over
  Detector. When this was all one file that worked by accident: every name lived in one
  shared scope and was only ever resolved at call time, long after everything had loaded.

  Splitting into modules loses that property, and plain `require` cycles would hand back
  half-initialised exports. This object restores it explicitly. Modules require it once and
  read `RT.Player`, `RT.Controller`, ... *inside* functions, so resolution still happens at
  call time. lib/boot.js fills it in, in dependency order.

  Rule: never destructure off RT at module load time, and never cache an RT value in a
  module-level const. Read through RT at the point of use.
*/
module.exports = {};
