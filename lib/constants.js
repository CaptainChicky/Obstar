/*
	Engine constants shared across the split-out modules.
*/
// public/SHARE/Physics.js is the one place this number is written down now, re-exported here
// so the ~8 existing require('../lib/constants.js').FRICTION consumers (entities/Bullet.js,
// entities/Objects.js, lib/boot.js, ...) don't all have to move to Physics.js directly.
exports.FRICTION = require('../public/SHARE/Physics.js').FRICTION;
